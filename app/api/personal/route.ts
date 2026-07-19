import { NextResponse } from "next/server";
import { z } from "zod";

import {
  MAX_NOTE_LENGTH,
  PERSONAL_ITEM_KINDS,
  itemExists,
  resolvableItems,
  type PersonalItemState,
} from "@/lib/personal/items";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The personal plane's API — one signed-in reader's progress, bookmarks and notes.
 *
 * ── Why this is an API route and not server-rendered ──────────────────────────
 *
 * Every page this data decorates (`/learn/*`, `/help/*`, `/trust/*`, the academy)
 * is statically prerendered and served from the CDN. Reading the viewer's state
 * during render would opt those routes out of static generation and put an
 * origin round trip from Paris in front of the fastest pages on the site — for a
 * checkbox. So the pages stay static and anonymous, and the personal layer
 * arrives afterwards on the client. This is the same split as the landing page's
 * client-side auth chrome, and for the same reason.
 *
 * ── no-store is load-bearing, not boilerplate ─────────────────────────────────
 *
 * Responses are per-user and must never be reused for anyone else. Cloudflare
 * fronts Vercel here, and a shared-cache hit on this endpoint would serve one
 * reader's private notes to the next visitor. `no-store` is set explicitly on
 * every response — including errors, which are also per-user — rather than left
 * to a default that a future config change could quietly alter.
 */

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
} as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const kind = z.enum(PERSONAL_ITEM_KINDS as unknown as [string, ...string[]]);

const patchSchema = z
  .object({
    kind,
    slug: z.string().min(1).max(160),
    /*
      Tri-state, deliberately. `true` sets the timestamp, `false` clears it, and
      absent means "leave it alone" — which is what lets a note be saved without
      the caller having to know or resend the item's completion state. A boolean
      that could only be true would make un-bookmarking impossible; one that
      defaulted to false would clear a flag every time the note changed.
    */
    completed: z.boolean().optional(),
    bookmarked: z.boolean().optional(),
    viewed: z.boolean().optional(),
    note: z.string().max(MAX_NOTE_LENGTH).nullable().optional(),
  })
  .strict();

/**
 * Postgres "relation does not exist".
 *
 * Migration 0088 is applied by the owner, so there is a real window where this
 * code is deployed and the table is not. A 500 during that window would break
 * every lesson and article page's personal layer; treating it as "no state yet"
 * degrades to exactly the signed-out experience, which is the correct fallback.
 * The same defensive shape as the wallpaper column added in 0073.
 */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01";
}

function toState(row: Record<string, unknown>): PersonalItemState {
  return {
    kind: row.item_kind as PersonalItemState["kind"],
    slug: row.item_slug as string,
    completedAt: (row.completed_at as string | null) ?? null,
    bookmarkedAt: (row.bookmarked_at as string | null) ?? null,
    lastViewedAt: (row.last_viewed_at as string | null) ?? null,
    note: (row.note as string | null) ?? null,
  };
}

/** GET /api/personal — everything this reader has completed, saved or noted. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed out is not an error here: every page that calls this renders fine
  // without a personal layer, and a 401 would put a red herring in the console
  // on every anonymous visit to a lesson.
  if (!user) return json({ items: [] });

  const { data, error } = await supabase
    .from("personal_learning_items")
    .select("item_kind, item_slug, completed_at, bookmarked_at, last_viewed_at, note")
    .eq("user_id", user.id);

  if (error) {
    if (isMissingTable(error)) return json({ items: [], pendingMigration: true });
    return json({ error: "Could not load your progress." }, 500);
  }

  /*
    Stale rows are hidden on read rather than deleted. Content gets renamed, and
    a reader's note is theirs — dropping it because we changed a slug would be a
    worse failure than an entry that quietly stops appearing.
  */
  return json({ items: resolvableItems((data ?? []).map(toState)) });
}

/**
 * PATCH /api/personal — update one item's state for this reader.
 *
 * Upsert on the composite key: the row may not exist yet (nothing has been
 * completed or saved), and requiring the client to know which case it is in
 * would mean a read before every write.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "Sign in required." }, 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Invalid request." }, 400);

  const { kind: itemKind, slug, completed, bookmarked, viewed, note } = parsed.data;

  /*
    The check the database cannot make.

    Lessons and articles are compiled TypeScript, so there is no foreign key. A
    caller could otherwise store any slug it liked and fill its own saved list
    with entries that 404 — or use a self-writable table as free storage keyed by
    arbitrary strings.
  */
  if (!itemExists(itemKind as PersonalItemState["kind"], slug)) {
    return json({ error: "Unknown item." }, 404);
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    user_id: user.id,
    item_kind: itemKind,
    item_slug: slug,
  };

  // Only fields the caller actually sent are touched — see the tri-state note
  // on the schema. `false` clears, absent leaves alone.
  if (completed !== undefined) patch.completed_at = completed ? now : null;
  if (bookmarked !== undefined) patch.bookmarked_at = bookmarked ? now : null;
  if (viewed) patch.last_viewed_at = now;
  if (note !== undefined) patch.note = note && note.trim().length > 0 ? note : null;

  const { data, error } = await supabase
    .from("personal_learning_items")
    .upsert(patch, { onConflict: "user_id,item_kind,item_slug" })
    .select("item_kind, item_slug, completed_at, bookmarked_at, last_viewed_at, note")
    .single();

  if (error) {
    if (isMissingTable(error)) return json({ error: "Not available yet." }, 503);
    return json({ error: "Could not save." }, 500);
  }

  return json({ item: toState(data as Record<string, unknown>) });
}
