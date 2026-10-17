import "server-only";

import { emailMember } from "@/lib/email/member-email";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { categoryForType } from "@/lib/social/notifications";
import { createAdminClient } from "@/lib/supabase/admin";

import { isCancelled, reminderCopy, reminderDue, RENEW_WINDOW_DAYS, type ReminderKind } from "./lifecycle";
import { subConfig } from "./server";

/**
 * Renewal and expiry reminders for PAID subscriptions (Frenz Exclusive Part 5). Subscriptions
 * never renew by themselves, so a subscriber hears, once each per paid period:
 *
 *   renew_3d   three days before access ends   push + in-app + email
 *   renew_1d   the day before                  push + in-app
 *   expired    once it has ended (≤ 2 days)    push + in-app + email
 *
 * Runs inside the existing 10-minute ai-reconcile invocation (no new cron: the Vercel slots are
 * spent). Bounded per run.
 *
 * ── Once, and only to the right people ──────────────────────────────────────
 *  · A reminder is CLAIMED before it is sent: an insert into sub_membership_reminders, whose
 *    primary key is (membership, period_index, kind). A second run — or two at once — gets
 *    nothing back from the claim and sends nothing. Without that table (before 0250 runs) the
 *    sweep sends nothing at all.
 *  · Only status 'active' memberships are read: a refund/dispute that took the period away ends
 *    the row (reverse_sub_purchase), and a removal sets 'removed', so neither is reminded.
 *  · A renewal moves period_end out of the window and period_index on: the old period's
 *    reminders can't fire, and the new period gets its own.
 *  · A subscriber who cancelled for this period isn't asked to renew.
 *  · Blocked pairs, suspended accounts and creators no longer selling are skipped.
 *  · Push follows the member's settings (category of `renewal_reminder`), and nothing in the
 *    copy names or describes a post — only the creator's public name.
 */

type Row = Record<string, unknown>;
const DAY = 86_400_000;

// 25 a run keeps every id list below well inside a request URL; the 10-minute clock makes that 3,600 a day
export async function sweepSubReminders(limit = 25, now = Date.now()): Promise<{ checked: number; sent: number; skipped?: string }> {
  const out = { checked: 0, sent: 0 };
  const db = createAdminClient();
  // the dedupe must exist before anything is sent
  const probe = await db.from("sub_membership_reminders").select("membership_id").limit(1);
  if (probe.error) return { ...out, skipped: "pending_migration" };

  const { data, error } = await db
    .from("creator_memberships")
    .select("*")
    .eq("status", "active")
    .eq("billing", "sub")
    .gt("period_end", new Date(now - 2 * DAY).toISOString())
    .lte("period_end", new Date(now + RENEW_WINDOW_DAYS * DAY).toISOString())
    .order("period_end", { ascending: true })
    .limit(limit * 4);
  if (error || !data?.length) return out;

  const due: { row: Row; kind: ReminderKind }[] = [];
  for (const r of data as Row[]) {
    const kind = reminderDue(r.period_end as string, now);
    if (!kind) continue;
    const cp = r.cancel_period;
    if (isCancelled({ cancelPeriod: typeof cp === "number" ? cp : null, periodIndex: Number(r.period_index ?? 0) })) continue;
    due.push({ row: r, kind });
  }
  if (!due.length) return out;

  // what this period already got, in one read: a later kind supersedes an earlier one
  const ids = due.map((d) => d.row.id as string);
  const sentR = await db.from("sub_membership_reminders").select("membership_id, period_index, kind").in("membership_id", ids);
  if (sentR.error) return out;
  const sent = new Set(((sentR.data ?? []) as Row[]).map((s) => `${s.membership_id as string}:${String(s.period_index)}:${s.kind as string}`));
  const ORDER: ReminderKind[] = ["renew_3d", "renew_1d", "expired"];
  const fresh = due.filter(({ row, kind }) => !ORDER.slice(ORDER.indexOf(kind)).some((k) => sent.has(`${row.id as string}:${String(row.period_index)}:${k}`))).slice(0, limit);
  if (!fresh.length) return out;

  const people = [...new Set(fresh.flatMap(({ row }) => [row.creator_id as string, row.member_id as string]))];
  const creators = [...new Set(fresh.map(({ row }) => row.creator_id as string))];
  const [cfg, profR, setR, blockR] = await Promise.all([
    subConfig(),
    db.from("profiles").select("id, handle, display_name, is_suspended, is_hidden").in("id", people),
    db.from("creator_membership_settings").select("creator_id, sub_active, sub_price_cents").in("creator_id", creators),
    db.from("blocks").select("blocker_id, blocked_id").in("blocker_id", people).in("blocked_id", people),
  ]);
  // any of these failing sends nothing this run (the next run tries again; nothing was claimed)
  if (profR.error || setR.error || blockR.error) return out;
  const prof = new Map(((profR.data ?? []) as Row[]).map((p) => [p.id as string, p]));
  const sets = new Map(((setR.data ?? []) as Row[]).map((s) => [s.creator_id as string, s]));
  const blocks = new Set(((blockR.data ?? []) as Row[]).map((b) => `${b.blocker_id as string}>${b.blocked_id as string}`));

  for (const { row, kind } of fresh) {
    out.checked += 1;
    const cid = row.creator_id as string;
    const mid = row.member_id as string;
    const creator = prof.get(cid);
    const member = prof.get(mid);
    if (!creator || !member || creator.is_suspended || member.is_suspended) continue;
    if (blocks.has(`${cid}>${mid}`) || blocks.has(`${mid}>${cid}`)) continue;
    const s = sets.get(cid);
    const canRenew = cfg.purchasesEnabled && !!s?.sub_active && Number(s?.sub_price_cents ?? 0) > 0 && !creator.is_hidden;
    // "renew soon" from a creator who no longer sells would be a dead end
    if (kind !== "expired" && !canRenew) continue;

    const claim = await db
      .from("sub_membership_reminders")
      .upsert({ membership_id: row.id as string, period_index: Number(row.period_index ?? 0), kind, member_id: mid }, { onConflict: "membership_id,period_index,kind", ignoreDuplicates: true })
      .select("kind");
    if (claim.error || !((claim.data ?? []) as Row[]).length) continue;

    const name = ((creator.display_name as string | null) || `@${creator.handle as string}`).slice(0, 60);
    const copy = reminderCopy(kind, name, canRenew);
    const tasks: Promise<unknown>[] = [
      sendSmartPush(
        mid,
        { title: copy.title, body: copy.body, genericBody: "A subscription update", url: "/account/subscriptions", tag: `sub-renew:${row.id as string}`, actorId: cid },
        kind === "renew_1d" ? "medium" : "low",
        categoryForType("renewal_reminder"),
        { type: "renewal_reminder", actorId: null },
      ),
    ];
    if (kind !== "renew_1d") tasks.push(emailMember(mid, { subject: copy.title, heading: copy.title, intro: copy.body, ctaLabel: "Manage subscriptions", ctaPath: "/account/subscriptions" }, "subscription_renewal"));
    await Promise.allSettled(tasks);
    out.sent += 1;
  }
  return out;
}
