import { NextResponse } from "next/server";
import { z } from "zod";

import { sendAdminEmail } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ratings — a member or guest rates the app (migration 0111).
 *
 * Guests are accepted deliberately: the downloader needs no account, so most
 * people with an opinion are signed out, and requiring sign-in would collect
 * feedback only from the least representative group.
 *
 * Upserts, so rating again updates rather than erroring — a person changing
 * their mind is not an error condition.
 */

const schema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional().or(z.literal("").transform(() => undefined)),
  downloads: z.number().int().min(0).max(100_000).optional(),
  surface: z.enum(["landing", "downloads", "history"]).optional(),
  /** The analytics visitor id, so a guest isn't asked twice. */
  visitorId: z.string().trim().max(64).optional(),
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid rating." }, { status: 400 });
  }

  // The signed-in user, when there is one. Never taken from the body.
  let userId: string | null = null;
  let email: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
    email = user?.email ?? null;
  } catch {
    /* signed out — a guest rating is still valid */
  }

  const { rating, comment, downloads, surface, visitorId } = parsed.data;
  const row = {
    user_id: userId,
    visitor_id: userId ? null : (visitorId ?? null),
    rating,
    comment: comment ?? null,
    downloads: downloads ?? null,
    surface: surface ?? null,
    updated_at: new Date().toISOString(),
  };

  /*
    ── Store, then always email ──────────────────────────────────────────
    Owner (2026-08-04): "I didn't receive any email on rating."

    The original order was the bug. It stored the row FIRST and returned 503
    on failure, so with migration 0111 unapplied the request never reached the
    email at all — every rating anyone left was thrown away silently, which is
    the worst possible outcome for the one feature whose entire purpose is
    carrying feedback to a person.

    So the write and the notification are now independent. The email goes out
    whatever the database does, and says so when the row could not be kept.
  */
  /*
    🔴 FIND-THEN-WRITE, NOT `upsert({ onConflict })` (owner, 2026-08-23:
    "rating doesn't show in admin, all previous ratings aren't showing
    anything").

    This was silently discarding EVERY rating ever submitted. Migration 0111
    dedupes with two PARTIAL unique indexes — `(user_id) WHERE user_id IS NOT
    NULL` and `(visitor_id) WHERE user_id IS NULL AND visitor_id IS NOT NULL` —
    which is the right model (a guest who later signs in must not be blocked,
    and one null user_id must not block every guest). But PostgreSQL can only
    infer a PARTIAL index for `ON CONFLICT` when the statement repeats that
    index's WHERE predicate, and PostgREST has no way to send one. So every
    write raised 42P10, "there is no unique or exclusion constraint matching
    the ON CONFLICT specification".

    Reproduced directly against the live database before changing anything:
    the old upsert returned 400/42P10 while a plain insert returned 201. The
    table was present and completely empty, which is why the dashboard looked
    broken rather than pending — `getRatings` correctly reported "available,
    zero rows", because that was true.

    The write and the email were already independent (see the note above), so
    every rating still reached a person — the email was simply the only copy.

    Selecting first is what the partial indexes cost us; they stay, because the
    alternative is a single constraint that gets the semantics wrong. The
    unique violation is still caught below, so the index remains the real
    guarantee and this is only the fast path.
  */
  let stored = false;
  try {
    const db = createAdminClient();

    const findExisting = async (): Promise<string | null> => {
      if (userId) {
        const { data } = await db.from("app_ratings").select("id").eq("user_id", userId).maybeSingle();
        return (data?.id as string | undefined) ?? null;
      }
      if (visitorId) {
        // `is("user_id", null)` mirrors the guest index's predicate exactly —
        // without it a guest could match a signed-in member's row that happens
        // to carry the same visitor id from before they created an account.
        const { data } = await db
          .from("app_ratings")
          .select("id")
          .is("user_id", null)
          .eq("visitor_id", visitorId)
          .maybeSingle();
        return (data?.id as string | undefined) ?? null;
      }
      // No identity at all (a guest with cookies blocked): nothing to dedupe
      // against, so this is always a fresh row. Better a duplicate rating than
      // a discarded one.
      return null;
    };

    const existingId = await findExisting();
    if (existingId) {
      const { error } = await db.from("app_ratings").update(row).eq("id", existingId);
      stored = !error;
    } else {
      const { error } = await db.from("app_ratings").insert(row);
      if (!error) {
        stored = true;
      } else if (error.code === "23505") {
        /*
          Lost a race: another request inserted this rater's row between the
          select and the insert. The partial index did its job — treat it as
          the update it should have been rather than dropping the rating, which
          is the failure this whole block exists to end.
        */
        const raced = await findExisting();
        if (raced) {
          const { error: updateError } = await db.from("app_ratings").update(row).eq("id", raced);
          stored = !updateError;
        }
      }
    }
  } catch {
    stored = false;
  }

  /*
    Never let the mail hop delay or fail the response. The person rating has
    done their part the moment they tapped send; whether our mail provider is
    reachable is not their problem, and blocking on it would make a slow SMTP
    round trip look like a broken button.
  */
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  void sendAdminEmail(
    `App rating: ${rating}/5${comment ? " — with a comment" : ""}`,
    `<h2 style="margin:0 0 12px">${stars} &nbsp;${rating}/5</h2>
     <p style="margin:0 0 8px"><strong>From:</strong> ${escapeHtml(email ?? (userId ? "signed-in member" : "guest"))}</p>
     <p style="margin:0 0 8px"><strong>Downloads completed:</strong> ${downloads ?? "unknown"}</p>
     <p style="margin:0 0 8px"><strong>Where:</strong> ${escapeHtml(surface ?? "unknown")}</p>
     ${comment ? `<blockquote style="margin:16px 0;padding:12px 16px;background:#f4f4f5;border-radius:8px">${escapeHtml(comment)}</blockquote>` : "<p style='color:#71717a'>No comment left.</p>"}
     ${stored ? "" : `<p style="margin:16px 0 0;padding:12px 16px;background:#fef2f2;border-radius:8px;color:#991b1b"><strong>Not saved to the dashboard.</strong> Migration <code>0111_app_ratings.sql</code> looks unapplied — this email is the only copy of this rating.</p>`}`,
  ).catch(() => {});

  // `ok` either way: the rating reached its destination. Telling the rater it
  // failed would invite them to send it again, which helps nobody.
  return NextResponse.json({ ok: true, stored });
}
