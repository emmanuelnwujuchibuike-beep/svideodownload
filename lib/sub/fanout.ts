import "server-only";

import { emailMember } from "@/lib/email/member-email";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { pushPerson } from "@/lib/push/identity";
import { excludedFor } from "@/lib/social/creator-notify-emit";
import { createAdminClient } from "@/lib/supabase/admin";

import { isUuid } from "./guards";

/**
 * The Exclusive notification fan-out (Frenz Exclusive Part 6, 0251) — for a creator's subscriber
 * announcement and for a new private post. One job per item; recipients in bounded pages.
 *
 * ── Never twice ─────────────────────────────────────────────────────────────
 * A page of recipients is CLAIMED in one insert into sub_fanout_deliveries (primary key
 * job_id + recipient_id, ignoreDuplicates) before anything is sent. Only the rows that insert
 * returns are sent to, so a retried request, a second worker or the reconcile sweep reaching the
 * same page sends nothing again. A claim left as 'claimed' (the worker died mid-send) is never
 * re-sent: at most once, and reported as unconfirmed.
 *
 * ── Never to the wrong people ───────────────────────────────────────────────
 * Eligibility is re-read for every page, at send time, from the database — never from the
 * request that created the job:
 *   announcement   ACTIVE paid subscribers (status active, billing sub, period_end in the future:
 *                  the hasActiveSub predicate), so expired, refunded, removed and ended
 *                  memberships are never read at all.
 *   private_post   members who asked for these alerts (creator_notification_prefs.private_posts);
 *                  for a HIDDEN post only those who are active subscribers right now (Part 3: a
 *                  hidden post exists only for those with access).
 * Then, for both: blocks either way and mutes (excludedFor — a failed read sends to nobody),
 * suspended accounts, and the item itself must still exist (an announcement not deleted; a post
 * still published and not taken down — and its CURRENT audience decides).
 *
 * ── Never the content ───────────────────────────────────────────────────────
 * The push, in-app row and email say only that the creator posted, with a link to their
 * Exclusive tab, where access is checked as always. No caption, title, body, media, storage key or
 * preview link travels in a notification.
 *
 * ── Honest outcomes ─────────────────────────────────────────────────────────
 * 'handed_off' means passed to the push / email pipeline (which applies the member's own
 * notification settings, quiet hours and caps); it is not "delivered" — this app cannot observe
 * delivery. 'skipped' = opted out or not eligible. 'failed' = the hand-off threw.
 */

type Row = Record<string, unknown>;
type Db = ReturnType<typeof createAdminClient>;
export type FanoutKind = "announcement" | "private_post";
export type Mode = "off" | "push" | "email" | "both";
export const FANOUT_PAGE = 200;
/**
 * Part 7 review: at most this many hand-offs at once. Each one reads the member's settings and may
 * call the push service, so a whole page at once (200) was a burst that could exhaust database
 * connections for a big creator. Bounded concurrency keeps one page cheap and steady.
 */
export const FANOUT_CONCURRENCY = 20;
const MODES = new Set(["off", "push", "email", "both"]);
const mode = (v: unknown, dflt: Mode): Mode => (typeof v === "string" && MODES.has(v) ? (v as Mode) : dflt);

/** Creates the job once per item (a repeat returns the same job). Null when 0251 hasn't run. */
export async function enqueueFanout(kind: FanoutKind, refId: string, creatorId: string): Promise<string | null> {
  if (!isUuid(refId) || !isUuid(creatorId)) return null;
  const db = createAdminClient();
  const ins = await db.from("sub_fanout_jobs").upsert({ creator_id: creatorId, kind, ref_id: refId }, { onConflict: "kind,ref_id", ignoreDuplicates: true }).select("id");
  if (ins.error) return null;
  const made = ((ins.data ?? []) as Row[])[0]?.id as string | undefined;
  if (made) return made;
  const { data } = await db.from("sub_fanout_jobs").select("id").eq("kind", kind).eq("ref_id", refId).maybeSingle();
  return ((data as Row | null)?.id as string | undefined) ?? null;
}

interface Item {
  ok: boolean;
  /** for a private post: the audience as it is NOW */
  hidden: boolean;
}

async function loadItem(db: Db, job: Row): Promise<Item> {
  if (job.kind === "announcement") {
    const { data } = await db.from("creator_notes").select("id, creator_id, audience, deleted_at").eq("id", job.ref_id as string).maybeSingle();
    const n = data as Row | null;
    return { ok: !!n && n.creator_id === job.creator_id && n.audience === "subscribers" && !n.deleted_at, hidden: false };
  }
  const { data } = await db.from("sub_posts").select("id, creator_id, status, audience, moderated_at").eq("id", job.ref_id as string).maybeSingle();
  const p = data as Row | null;
  return { ok: !!p && p.creator_id === job.creator_id && p.status === "published" && !p.moderated_at, hidden: p?.audience === "hidden" };
}

/** Active paid subscribers of `creatorId` among `ids` (or, with no ids, the next page after `cursor`). */
async function activeSubscribers(db: Db, creatorId: string, opts: { ids?: string[]; after?: string | null; limit?: number }): Promise<string[] | null> {
  let q = db.from("creator_memberships").select("member_id").eq("creator_id", creatorId).eq("status", "active").eq("billing", "sub").gt("period_end", new Date().toISOString());
  if (opts.ids) q = q.in("member_id", opts.ids);
  if (opts.after) q = q.gt("member_id", opts.after);
  const { data, error } = await q.order("member_id", { ascending: true }).limit(opts.limit ?? FANOUT_PAGE);
  return error ? null : ((data ?? []) as Row[]).map((r) => r.member_id as string);
}

interface PageResult {
  claimed: number;
  handedOff: number;
  skipped: number;
  failed: number;
  done: boolean;
}

/**
 * Processes ONE page of a job. Returns what it did; `done` when the recipient list is exhausted
 * (or the item is gone). Safe to call from several places at once.
 */
export async function processFanoutPage(jobId: string, pageSize = FANOUT_PAGE): Promise<PageResult | null> {
  const out: PageResult = { claimed: 0, handedOff: 0, skipped: 0, failed: 0, done: false };
  if (!isUuid(jobId)) return null;
  const db = createAdminClient();
  const { data: jobRow, error: jobErr } = await db.from("sub_fanout_jobs").select("*").eq("id", jobId).maybeSingle();
  const job = jobRow as Row | null;
  if (jobErr || !job) return null;
  if (job.state !== "pending") return { ...out, done: true };
  const creatorId = job.creator_id as string;
  const now = new Date().toISOString();

  const item = await loadItem(db, job);
  if (!item.ok) {
    await db.from("sub_fanout_jobs").update({ state: "cancelled", finished_at: now, updated_at: now }).eq("id", jobId).eq("state", "pending");
    return { ...out, done: true };
  }

  // ── the next page of candidates, keyset on the recipient id ──
  const after = (job.cursor as string | null) ?? null;
  let page: string[];
  const prefs = new Map<string, Row>();
  if (job.kind === "announcement") {
    const subs = await activeSubscribers(db, creatorId, { after, limit: pageSize });
    if (!subs) return null;
    page = subs;
    if (page.length) {
      const { data, error } = await db.from("creator_notification_prefs").select("viewer_id, announcements").eq("target_id", creatorId).in("viewer_id", page);
      if (error) return null;
      for (const p of (data ?? []) as Row[]) prefs.set(p.viewer_id as string, p);
    }
  } else {
    let q = db.from("creator_notification_prefs").select("viewer_id, private_posts").eq("target_id", creatorId).neq("private_posts", "off");
    if (after) q = q.gt("viewer_id", after);
    const { data, error } = await q.order("viewer_id", { ascending: true }).limit(pageSize);
    if (error) return null;
    page = ((data ?? []) as Row[]).map((p) => {
      prefs.set(p.viewer_id as string, p);
      return p.viewer_id as string;
    });
  }
  page = page.filter((id) => id !== creatorId);
  const exhausted = page.length < pageSize;
  if (!page.length) {
    await finish(db, jobId, after);
    return { ...out, done: true };
  }

  // ── eligibility, re-read now (batched) ──
  let excluded: Set<string>;
  let suspended: Set<string>;
  let allowed: Set<string> | null = null;
  try {
    const [ex, profR, subs] = await Promise.all([
      excludedFor(db, creatorId, page),
      db.from("profiles").select("id, is_suspended").in("id", page),
      // Part 3: a hidden post exists only for its active subscribers
      job.kind === "private_post" && item.hidden ? activeSubscribers(db, creatorId, { ids: page, limit: page.length }) : Promise.resolve(null),
    ]);
    if (profR.error) throw new Error("profiles");
    if (job.kind === "private_post" && item.hidden && !subs) throw new Error("subs");
    excluded = ex;
    suspended = new Set(((profR.data ?? []) as Row[]).filter((p) => p.is_suspended).map((p) => p.id as string));
    if (subs) allowed = new Set(subs);
  } catch {
    // a failed eligibility read sends to nobody (fails closed); nothing was claimed, the next run retries
    return null;
  }

  // ── claim the page (one insert); only what this call claimed is sent ──
  const claim = await db
    .from("sub_fanout_deliveries")
    .upsert(page.map((id) => ({ job_id: jobId, recipient_id: id, status: "claimed" })), { onConflict: "job_id,recipient_id", ignoreDuplicates: true })
    .select("recipient_id");
  if (claim.error) return null;
  const mine = ((claim.data ?? []) as Row[]).map((r) => r.recipient_id as string);
  out.claimed = mine.length;

  const who = mine.length ? await pushPerson(creatorId) : null;
  const tab = who?.handle ? `/u/${who.handle}?tab=sub` : "/exclusive";
  const results = new Map<string, { status: "handed_off" | "skipped" | "failed"; channels: string | null; detail: string | null }>();
  const handOff = async (id: string): Promise<void> => {
    if (excluded.has(id) || suspended.has(id) || (allowed && !allowed.has(id))) return void results.set(id, { status: "skipped", channels: null, detail: "not_eligible" });
    const p = prefs.get(id);
    const m = job.kind === "announcement" ? mode(p?.announcements, "push") : mode(p?.private_posts, "off");
    if (m === "off") return void results.set(id, { status: "skipped", channels: null, detail: "opted_out" });
    const channels: string[] = [];
    try {
      if (m === "push" || m === "both") {
        channels.push("push");
        await sendSmartPush(
          id,
          job.kind === "announcement"
            ? { title: who!.name, body: "Posted an announcement for subscribers", genericBody: "A new announcement", url: `${tab}#announcements`, icon: who!.icon, tag: `announce:${job.ref_id as string}`, actorId: creatorId }
            : { title: who!.name, body: "Posted a new private post", genericBody: "A new private post", url: tab, icon: who!.icon, tag: `private-post:${creatorId}`, actorId: creatorId },
          "medium",
          "social",
          { type: "news_following", actorId: creatorId },
        );
      }
      if (m === "email" || m === "both") {
        channels.push("email");
        await emailMember(
          id,
          job.kind === "announcement"
            ? { subject: `${who!.name} posted an announcement for subscribers`, heading: `${who!.name} posted an announcement`, intro: "It's for their subscribers. Open their Exclusive tab to read it.", ctaLabel: "Open their Exclusive tab", ctaPath: `${tab}#announcements` }
            : { subject: `${who!.name} posted a new private post`, heading: `${who!.name} posted a new private post`, intro: "You asked to hear when they share something for their subscribers.", ctaLabel: "Open their private posts", ctaPath: tab },
        );
      }
      results.set(id, { status: "handed_off", channels: channels.join(","), detail: null });
    } catch (e) {
      results.set(id, { status: "failed", channels: channels.join(",") || null, detail: String(e).slice(0, 120) });
    }
  };
  for (let i = 0; i < mine.length; i += FANOUT_CONCURRENCY) await Promise.all(mine.slice(i, i + FANOUT_CONCURRENCY).map(handOff));

  // ── record outcomes, grouped (one update per outcome) ──
  const groups = new Map<string, string[]>();
  for (const [id, r] of results) {
    const key = JSON.stringify([r.status, r.channels, r.detail]);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  for (const [key, ids] of groups) {
    const [status, channels, detail] = JSON.parse(key) as [string, string | null, string | null];
    await db.from("sub_fanout_deliveries").update({ status, channels, detail, updated_at: new Date().toISOString() }).eq("job_id", jobId).in("recipient_id", ids);
    if (status === "handed_off") out.handedOff += ids.length;
    else if (status === "skipped") out.skipped += ids.length;
    else out.failed += ids.length;
  }

  const last = page[page.length - 1]!;
  await db
    .from("sub_fanout_jobs")
    .update({
      cursor: last,
      handed_off: Number(job.handed_off ?? 0) + out.handedOff,
      skipped: Number(job.skipped ?? 0) + out.skipped,
      failed: Number(job.failed ?? 0) + out.failed,
      runs: Number(job.runs ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("state", "pending");
  if (exhausted) await finish(db, jobId, last);
  return { ...out, done: exhausted };
}

async function finish(db: Db, jobId: string, cursor: string | null): Promise<void> {
  const at = new Date().toISOString();
  await db.from("sub_fanout_jobs").update({ state: "done", cursor, finished_at: at, updated_at: at }).eq("id", jobId).eq("state", "pending");
}

/** The first page, right after publishing (inside `after()`): bounded, the rest is the sweep's. */
export async function startFanout(jobId: string, maxPages = 1): Promise<void> {
  for (let i = 0; i < maxPages; i++) {
    const r = await processFanoutPage(jobId).catch(() => null);
    if (!r || r.done) return;
  }
}

/** The 10-minute reconcile run: a few pending jobs, a few pages each. Never a backlog in one call. */
export async function sweepFanout(maxJobs = 3, pagesPerJob = 3): Promise<{ jobs: number; pages: number; skipped?: string }> {
  const db = createAdminClient();
  const { data, error } = await db.from("sub_fanout_jobs").select("id").eq("state", "pending").order("created_at", { ascending: true }).limit(maxJobs);
  if (error) return { jobs: 0, pages: 0, skipped: "pending_migration" };
  let pages = 0;
  for (const j of (data ?? []) as Row[]) {
    for (let i = 0; i < pagesPerJob; i++) {
      const r = await processFanoutPage(j.id as string).catch(() => null);
      pages += 1;
      if (!r || r.done) break;
    }
  }
  return { jobs: (data ?? []).length, pages };
}

/** What a creator sees about one job: counts, honestly named. */
export interface FanoutStatus {
  state: "pending" | "done" | "cancelled";
  handedOff: number;
  skipped: number;
  failed: number;
}

export async function fanoutStatuses(kind: FanoutKind, refIds: string[]): Promise<Map<string, FanoutStatus>> {
  const out = new Map<string, FanoutStatus>();
  const ids = refIds.filter(isUuid);
  if (!ids.length) return out;
  const { data, error } = await createAdminClient().from("sub_fanout_jobs").select("ref_id, state, handed_off, skipped, failed").eq("kind", kind).in("ref_id", ids);
  if (error) return out;
  for (const r of (data ?? []) as Row[]) out.set(r.ref_id as string, { state: r.state as FanoutStatus["state"], handedOff: Number(r.handed_off ?? 0), skipped: Number(r.skipped ?? 0), failed: Number(r.failed ?? 0) });
  return out;
}
