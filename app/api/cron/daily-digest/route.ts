import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { computeDigestStats, formatDigestBody, isDigestEligible, type DigestSettingsRow } from "@/lib/social/digest";
import { markDigestSent } from "@/lib/social/notification-settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Part 8 Smart Daily Digest cron. Same auth pattern as every other cron
 * route in this app (see friend-reminders' identical comment) — not
 * registered in vercel.json by default (Hobby-plan cron limits); add a
 * once-daily schedule on a plan that allows it.
 *
 * Iterates `profiles` via keyset pagination (id > cursor) rather than
 * loading every user into memory at once — the one real gap the research
 * for this round found (neither existing cron route needed true pagination:
 * friend-reminders is a single bounded query, trending delegates to one SQL
 * RPC). Bounded to MAX_USERS_PER_RUN per invocation, matching
 * broadcasts.ts's MAX_TARGETS cap — a genuinely unbounded user base would
 * need a real queue, which this app's actual scale doesn't call for yet
 * (same reasoning as every other "not solving a scale problem we don't
 * have" decision in this codebase).
 *
 * The digest is PUSH-ONLY — it never creates a `notifications` row. Its
 * content (real counts since the last digest) is inherently dynamic text
 * that the notifications table has no column for (every other type's
 * display text is derived purely from `type` at read time — see
 * features/notifications/meta.tsx's verbFor) and adding one JUST for this
 * would be real schema surface for a single feature. A push-only nudge is
 * also the more honest shape for "come back and see what's new" anyway.
 */
const BATCH_SIZE = 200;
const MAX_USERS_PER_RUN = 2_000;
const MIN_HOURS_BETWEEN_DIGESTS = 20; // slightly under 24h so a daily cadence never drifts later each day

async function authorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return !!(await getAdminUser());
}

interface SettingsRow extends DigestSettingsRow {
  user_id: string;
}

async function run(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = createAdminClient();
  const now = Date.now();

  let cursor: string | null = null;
  let scanned = 0;
  let sent = 0;
  let skipped = 0;

  while (scanned < MAX_USERS_PER_RUN) {
    let q = db.from("profiles").select("id").not("handle", "is", null).order("id", { ascending: true }).limit(BATCH_SIZE);
    if (cursor) q = q.gt("id", cursor);
    const { data: profileRows } = await q;
    const ids = ((profileRows ?? []) as { id: string }[]).map((p) => p.id);
    if (ids.length === 0) break;
    cursor = ids[ids.length - 1]!;
    scanned += ids.length;

    const { data: settingsRows } = await db
      .from("notification_settings")
      .select("user_id, digest_enabled, last_digest_sent_at")
      .in("user_id", ids);
    const settingsById = new Map(((settingsRows ?? []) as SettingsRow[]).map((r) => [r.user_id, r]));

    for (const userId of ids) {
      const settings = settingsById.get(userId);
      if (!isDigestEligible(settings, now, MIN_HOURS_BETWEEN_DIGESTS)) {
        skipped++;
        continue;
      }
      const since = settings?.last_digest_sent_at ? new Date(settings.last_digest_sent_at) : new Date(Date.now() - 24 * 60 * 60_000);
      const stats = await computeDigestStats(userId, since);
      const body = formatDigestBody(stats);
      // Always mark as sent-this-cycle even when there's nothing to report —
      // otherwise a quiet user gets re-scanned (and re-queried) every single
      // run instead of settling into the same daily cadence as everyone else.
      await markDigestSent(userId);
      if (!body) {
        skipped++;
        continue;
      }
      await sendSmartPush(userId, { title: "Good morning 👋", body, url: "/notifications", tag: "daily-digest" }, "low", "system");
      sent++;
    }

    if (ids.length < BATCH_SIZE) break; // last page
  }

  return NextResponse.json({ ok: true, scanned, sent, skipped });
}

export const GET = run;
export const POST = run;
