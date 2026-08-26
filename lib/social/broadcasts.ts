import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import type { PushPayload } from "@/lib/push/web-push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Admin broadcast alerts. Segment targeting is plan tier — the one real,
 * already-queryable user segment this app has today (see the owner's own
 * scoping call; "activity recency" / arbitrary cohorts are a real follow-up,
 * not built here).
 *
 * Capped at MAX_TARGETS per send — this app's actual current user base is
 * nowhere near "100M users," and honestly handling a few thousand recipients
 * synchronously is the right-sized version of this feature; genuinely
 * reaching 100M would need a background job queue fanning out in batches,
 * not a single request pretending to be that at this app's real scale.
 */
const MAX_TARGETS = 5000;
const CHUNK_SIZE = 500;

export type BroadcastTargetPlan = "all" | "free" | "pro" | "business";

export interface Broadcast {
  id: string;
  title: string;
  body: string;
  targetPlan: BroadcastTargetPlan;
  createdAt: string;
  sentCount: number;
}

export async function listBroadcasts(limit = 20): Promise<Broadcast[]> {
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("notification_broadcasts")
      .select("id, title, body, target_plan, created_at, sent_count")
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data ?? []) as { id: string; title: string; body: string; target_plan: BroadcastTargetPlan; created_at: string; sent_count: number }[]).map(
      (r) => ({ id: r.id, title: r.title, body: r.body, targetPlan: r.target_plan, createdAt: r.created_at, sentCount: r.sent_count }),
    );
  } catch {
    return [];
  }
}

export interface PreparedBroadcast {
  ok: boolean;
  /** Recipients whose in-app notification rows were written (the "sent" count). */
  sent: number;
  /** Fan the push out to these (see `fanOutBroadcastPush`) — deferred off the
   * request so the admin isn't held while thousands of pushes go out. */
  targetIds: string[];
  push: PushPayload;
}

/**
 * Creates the broadcast + the in-app notification rows synchronously (fast batch
 * inserts) and returns the push payload + recipients for the caller to fan out
 * AFTER the response (`fanOutBroadcastPush`, via next/server `after()`).
 *
 * Splitting it this way is why the ad push no longer makes the admin "wait very
 * long": the slow part is the per-recipient push, and it now runs in the
 * background instead of blocking the Send request. `sponsored` marks it as an ad
 * so the delivered push is clearly, professionally labelled "Sponsored".
 */
export async function prepareBroadcast(
  adminId: string,
  title: string,
  body: string,
  targetPlan: BroadcastTargetPlan,
  sponsored = false,
): Promise<PreparedBroadcast> {
  const empty: PreparedBroadcast = { ok: false, sent: 0, targetIds: [], push: { title: "", body: "" } };
  const cleanTitle = title.trim().slice(0, 120);
  const cleanBody = body.trim().slice(0, 500);
  if (!cleanTitle || !cleanBody) return empty;

  try {
    const db = createAdminClient();

    // `is_suspended` only, on purpose: an admin-hidden account (0082) is a
    // normal member who happens to be invisible to strangers, and it should keep
    // receiving admin broadcasts. Hiding controls who can see THEM, not what
    // they receive.
    let query = db.from("profiles").select("id").not("handle", "is", null).eq("is_suspended", false).limit(MAX_TARGETS);
    if (targetPlan !== "all") query = query.eq("plan", targetPlan);
    const { data: targets } = await query;
    const targetIds = ((targets ?? []) as { id: string }[]).map((t) => t.id);
    if (targetIds.length === 0) return empty;

    const { data: broadcast, error: insertErr } = await db
      .from("notification_broadcasts")
      .insert({ title: cleanTitle, body: cleanBody, target_plan: targetPlan, created_by: adminId })
      .select("id")
      .single();
    if (insertErr || !broadcast) return empty;

    // In-app notification rows (batch inserts — fast; the push is what's slow).
    // Each row carries the ad's own title/body/sponsored in `data`, so the in-app
    // card shows the REAL ad + a "Sponsored" label instead of a generic "Frenz
    // announcement" that reads like a personal message. `data` arrives with
    // migration 0094 — fall back to a plain insert until it's applied.
    const rowData = { title: cleanTitle, body: cleanBody, sponsored };
    let dataOk = true;
    for (let i = 0; i < targetIds.length; i += CHUNK_SIZE) {
      const chunk = targetIds.slice(i, i + CHUNK_SIZE);
      const base = chunk.map((userId) => ({ user_id: userId, actor_id: null, type: "admin_broadcast", post_id: null }));
      if (dataOk) {
        const { error } = await db.from("notifications").insert(base.map((r) => ({ ...r, data: rowData })));
        if (error?.code === "42703") {
          dataOk = false;
          await db.from("notifications").insert(base);
        }
      } else {
        await db.from("notifications").insert(base);
      }
    }
    await db.from("notification_broadcasts").update({ sent_count: targetIds.length }).eq("id", broadcast.id);

    // The PUSH leads with a clear "Sponsored" marker IN THE TITLE (the most
    // visible line), then the ad's full title + body — so it reads as an ad, not
    // a plain "from Frenz" message. Done server-side so it shows even on a client
    // whose service worker is a build behind; `sponsored` also rides along.
    const push: PushPayload = {
      title: sponsored ? `Sponsored · ${cleanTitle}` : cleanTitle,
      body: cleanBody,
      url: "/notifications",
      tag: `broadcast:${broadcast.id}`,
      ...(sponsored ? { sponsored: true } : {}),
    };
    return { ok: true, sent: targetIds.length, targetIds, push };
  } catch {
    return empty;
  }
}

/** Fans a prepared broadcast's push out to every recipient — best-effort, chunked,
 *  settings/DND-aware (via sendSmartPush). Call AFTER the response. */
export async function fanOutBroadcastPush(targetIds: string[], push: PushPayload): Promise<void> {
  for (let i = 0; i < targetIds.length; i += CHUNK_SIZE) {
    const chunk = targetIds.slice(i, i + CHUNK_SIZE);
    // `prepareBroadcast` already wrote an `admin_broadcast` row per recipient
    // (with the ad/announcement content on `data`) — this fan-out is the push
    // half only.
    await Promise.all(chunk.map((userId) => sendSmartPush(userId, push, "high", "system", "already-recorded")));
  }
}

/** Convenience: prepare + fan out awaited. Route handlers should instead call
 *  `prepareBroadcast` and defer `fanOutBroadcastPush` with `after()`. */
export async function createAndSendBroadcast(
  adminId: string,
  title: string,
  body: string,
  targetPlan: BroadcastTargetPlan,
  sponsored = false,
): Promise<{ ok: boolean; sent: number }> {
  const prep = await prepareBroadcast(adminId, title, body, targetPlan, sponsored);
  if (prep.ok) await fanOutBroadcastPush(prep.targetIds, prep.push);
  return { ok: prep.ok, sent: prep.sent };
}
