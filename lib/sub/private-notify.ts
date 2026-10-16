import "server-only";

import { emailMember } from "@/lib/email/member-email";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { pushPerson } from "@/lib/push/identity";
import { excludedFor } from "@/lib/social/creator-notify-emit";
import { createAdminClient } from "@/lib/supabase/admin";
import { paginatedSelect } from "@/lib/supabase/paginate";

/**
 * "Tell me when they post a private post" (owner 2026-10-12) — on the creator's PRIVATE POSTS tab,
 * by push, by email, or both. Stored on the existing per-person notification preferences (0129,
 * column private_posts from 0238). The notification never carries any of the post: it says a new
 * private post exists and opens the creator's tab, where access is checked as always — so it is
 * safe for a member who has not subscribed (it is how they learn there is something to subscribe to).
 */
export type PrivatePostMode = "off" | "push" | "email" | "both";
export const PRIVATE_POST_MODES: readonly PrivatePostMode[] = ["off", "push", "email", "both"];
const MAX_FANOUT = 2000;
// how many of a creator's active subscribers a hidden post's announcement reads to check against (Part 3)
const MAX_SUBSCRIBERS_READ = 20000;

export function isMode(v: unknown): v is PrivatePostMode {
  return typeof v === "string" && (PRIVATE_POST_MODES as readonly string[]).includes(v);
}

export async function getPrivatePostMode(viewerId: string, creatorId: string): Promise<{ mode: PrivatePostMode; ready: boolean }> {
  if (viewerId === creatorId) return { mode: "off", ready: true };
  const { data, error } = await createAdminClient().from("creator_notification_prefs").select("private_posts").eq("viewer_id", viewerId).eq("target_id", creatorId).maybeSingle();
  if (error) return { mode: "off", ready: !/column|schema cache/i.test(error.message) };
  const m = (data as { private_posts?: string } | null)?.private_posts;
  return { mode: isMode(m) ? m : "off", ready: true };
}

export async function setPrivatePostMode(viewerId: string, creatorId: string, mode: PrivatePostMode): Promise<{ ok: boolean; pending?: boolean }> {
  if (viewerId === creatorId) return { ok: false };
  const { error } = await createAdminClient().from("creator_notification_prefs").upsert({ viewer_id: viewerId, target_id: creatorId, private_posts: mode, updated_at: new Date().toISOString() }, { onConflict: "viewer_id,target_id" });
  if (error) return /column|schema cache/i.test(error.message) ? { ok: false, pending: true } : { ok: false };
  return { ok: true };
}

/** After a creator publishes a private post: everyone who asked, by the way they asked. Bounded; blocks and mutes respected. */
export async function notifyNewPrivatePost(creatorId: string, opts: { audience?: "locked" | "hidden" } = {}): Promise<void> {
  try {
    const db = createAdminClient();
    const read = await paginatedSelect<{ viewer_id: string; private_posts: string }>(
      (from, to) => db.from("creator_notification_prefs").select("viewer_id, private_posts").eq("target_id", creatorId).neq("private_posts", "off").range(from, to),
      MAX_FANOUT,
    );
    if (read.error || !read.rows.length) return;
    /*
      Part 3 (0248): a HIDDEN post exists only for those with access, so only ACTIVE subscribers
      hear about it — telling anyone else "they posted something" would announce a post they are
      never allowed to know exists. One batched read; a failed read sends nothing (fails closed).
    */
    if (opts.audience === "hidden") {
      // the creator's active subscribers, paged (an id list of up to MAX_FANOUT would not fit in a request URL)
      const now = new Date().toISOString();
      const subs = await paginatedSelect<{ member_id: string }>(
        (from, to) => db.from("creator_memberships").select("member_id").eq("creator_id", creatorId).eq("status", "active").eq("billing", "sub").gt("period_end", now).range(from, to),
        MAX_SUBSCRIBERS_READ,
      );
      if (subs.error) return;
      const allowed = new Set(subs.rows.map((s) => s.member_id));
      read.rows = read.rows.filter((r) => allowed.has(r.viewer_id));
      if (!read.rows.length) return;
    }
    const excluded = await excludedFor(db, creatorId, read.rows.map((r) => r.viewer_id));
    const who = await pushPerson(creatorId);
    const path = who.handle ? `/u/${who.handle}?tab=sub` : "/";
    for (const r of read.rows) {
      if (r.viewer_id === creatorId || excluded.has(r.viewer_id)) continue;
      const tasks: Promise<unknown>[] = [];
      if (r.private_posts === "push" || r.private_posts === "both") {
        tasks.push(
          sendSmartPush(
            r.viewer_id,
            { title: who.name, body: "Posted a new private post", genericBody: "A new private post", url: path, icon: who.icon, tag: `private-post:${creatorId}`, actorId: creatorId },
            "medium",
            "social",
            { type: "news_following", actorId: creatorId },
          ),
        );
      }
      if (r.private_posts === "email" || r.private_posts === "both") {
        tasks.push(
          emailMember(r.viewer_id, {
            subject: `${who.name} posted a new private post`,
            heading: `${who.name} posted a new private post`,
            intro: "You asked to hear when they share something for their subscribers.",
            ctaLabel: "Open their private posts",
            ctaPath: path,
          }),
        );
      }
      await Promise.all(tasks).catch(() => {});
    }
  } catch {
    /* best effort — publishing never waits on this */
  }
}
