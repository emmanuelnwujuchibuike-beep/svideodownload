import "server-only";

import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { categoryForType } from "@/lib/social/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { visibleTo } from "./guards";
import { readSubPostGate } from "./posts";
import { hasActiveSub } from "./server";

/**
 * "@handle took a screenshot of your SUB post" (owner, 2026-10-11: "if screen
 * record or screenshot can't be blocked on PWA or web, then notify the user on
 * push and in the notification page" … "then they decide to block or ignore").
 *
 * ── What can be seen, honestly ─────────────────────────────────────────────
 * A web page is told nothing when a phone takes a screenshot or records the
 * screen: no event exists on iOS or Android. What a browser DOES see is the
 * screenshot keyboard shortcut on a computer — Print Screen on Windows, and
 * Cmd+Shift+3/4/5 on a Mac — pressed while the private viewer is open. That is
 * the only signal this reports. It never guesses from the app losing focus (a
 * notification pull-down looks identical), so nobody is accused on a guess.
 *
 * ── Who can be reported ───────────────────────────────────────────────────
 * Only a viewer who could open the post (an active subscriber — the same
 * `hasActiveSub` the media links use), never the creator. One alert per viewer
 * per post per ten minutes, so holding a key can't flood the creator.
 *
 * The creator gets an in-app card (with Block and Ignore) and a push; the row
 * names the viewer through `actor_id` and carries the post id, nothing else.
 */

type Row = Record<string, unknown>;
export const CAPTURE_KINDS = ["print_screen", "mac_shortcut", "snip_shortcut"] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];
const WINDOW_MS = 10 * 60_000;

export async function reportSubCapture(postId: string, viewerId: string, kind: CaptureKind): Promise<{ ok: true; notified: boolean } | { ok: false; status: number; error: string }> {
  const db = createAdminClient();
  const gate = await readSubPostGate(postId);
  if (!gate) return { ok: false, status: 404, error: "Not found." };
  const creatorId = gate.creatorId;
  if (creatorId === viewerId) return { ok: true, notified: false };
  // Part 3: a hidden post answers a viewer without access exactly like a missing one
  if (!(await hasActiveSub(viewerId, creatorId))) return visibleTo(gate.audience, false) ? { ok: false, status: 403, error: "Forbidden." } : { ok: false, status: 404, error: "Not found." };

  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const { data: recent } = await db.from("notifications").select("id").eq("user_id", creatorId).eq("actor_id", viewerId).eq("type", "sub_capture").contains("data", { post_id: postId }).gte("created_at", since).limit(1);
  if ((recent ?? []).length) return { ok: true, notified: false };

  const { data: v } = await db.from("profiles").select("handle, display_name").eq("id", viewerId).maybeSingle();
  const viewer = v as Row | null;
  const name = viewer?.handle ? `@${viewer.handle as string}` : ((viewer?.display_name as string | null) ?? "A subscriber");
  const title = "Screenshot of your private post";
  const body = `${name} took a screenshot of your private post. Block them or ignore it.`;
  const { error } = await db.from("notifications").insert({ user_id: creatorId, actor_id: viewerId, type: "sub_capture", data: { post_id: postId, kind, title, body, url: "/members" } });
  if (error) return { ok: false, status: 503, error: "Couldn't record that." };
  await sendSmartPush(creatorId, { title, body, url: "/notifications", tag: `sub-capture-${postId}-${viewerId}` }, "high", categoryForType("sub_capture"), "already-recorded").catch(() => {});
  return { ok: true, notified: true };
}
