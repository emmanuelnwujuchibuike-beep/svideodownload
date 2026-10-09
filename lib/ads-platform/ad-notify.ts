import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendProductEmail } from "@/lib/email/resend";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";

/**
 * Advertiser notifications (Part 6 §12) — through the EXISTING push + Notification
 * Center (`sendSmartPush` records in-app too) AND the existing branded email
 * (`sendProductEmail`, owner 2026-10-08: "notification should also send as
 * email"). Server-confirmed events only, and
 * best-effort: a notification that fails is logged and swallowed, never able to
 * fail a payment, an activation or an edit.
 *
 * Existing notification types only — `payment_successful` for money, `system`
 * for campaign state — so the notifications table's type check is untouched.
 */
export type AdNotice =
  | { kind: "payment_verified" }
  | { kind: "activated"; endAt?: string | null }
  | { kind: "needs_review" }
  | { kind: "creative_approved" }
  | { kind: "creative_rejected" }
  | { kind: "paused" }
  | { kind: "resumed" }
  | { kind: "extended"; endAt: string | null }
  | { kind: "extension_held" }
  /* Part 7: the admin's decisions */
  | { kind: "paused_by_frenzsave" }
  | { kind: "rejected"; reason: string | null; refundOwed: boolean }
  | { kind: "removed"; reason: string | null; refundOwed: boolean };

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);

function words(n: AdNotice, name: string): { title: string; body: string; money: boolean } {
  switch (n.kind) {
    case "payment_verified":
      return { title: "Payment received", body: `Your payment for “${name}” is confirmed.`, money: true };
    case "activated":
      return { title: "Your ad is live", body: `“${name}” is now showing on Frenzsave${day(n.endAt) ? ` until ${day(n.endAt)}` : ""}.`, money: false };
    case "needs_review":
      return { title: "Your ad needs a check", body: `“${name}” is paid and waiting on a quick review before it goes live.`, money: false };
    case "creative_approved":
      return { title: "Ad updated", body: `Your new creative for “${name}” passed the checks and is now live.`, money: false };
    case "creative_rejected":
      return { title: "Update not applied", body: `Your new creative for “${name}” did not pass the checks. Your current ad is still live.`, money: false };
    case "paused":
      return { title: "Ad paused", body: `“${name}” is paused. Resume it any time before it ends.`, money: false };
    case "resumed":
      return { title: "Ad resumed", body: `“${name}” is live again.`, money: false };
    case "extended":
      return { title: "Campaign extended", body: `“${name}” now runs${day(n.endAt) ? ` until ${day(n.endAt)}` : " longer"}.`, money: true };
    case "extension_held":
      return { title: "Extension needs a check", body: `We received your extension payment for “${name}”, but the campaign had already stopped. Our team will contact you.`, money: true };
    case "paused_by_frenzsave":
      return { title: "Ad paused by Frenzsave", body: `“${name}” is paused while our team takes a look. We'll let you know when it can run again.`, money: false };
    case "rejected":
      return { title: "Ad not approved", body: `“${name}” wasn't approved${n.reason ? `: ${n.reason}` : "."}${n.refundOwed ? " Your payment will be refunded." : ""}`, money: n.refundOwed };
    case "removed":
      return { title: "Ad removed", body: `“${name}” was removed${n.reason ? `: ${n.reason}` : "."}${n.refundOwed ? " The unused part of your payment will be refunded." : ""}`, money: n.refundOwed };
  }
}

/** The campaign name is the advertiser's own text — it goes into HTML escaped. */
function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function notifyAdvertiser(db: SupabaseClient, campaignId: string, notice: AdNotice): Promise<void> {
  try {
    const { data } = await db.from("ad_campaigns").select("name, advertisers!inner(user_id, contact_email)").eq("id", campaignId).maybeSingle();
    const row = data as { name?: string; advertisers?: { user_id?: string; contact_email?: string | null } | { user_id?: string; contact_email?: string | null }[] } | null;
    const adv = Array.isArray(row?.advertisers) ? row?.advertisers[0] : row?.advertisers;
    if (!row || !adv?.user_id) return;
    const w = words(notice, row.name ?? "your campaign");
    // each channel on its own: a failed push never costs the email, nor the reverse
    await sendSmartPush(
      adv.user_id,
      { title: w.title, body: w.body, url: `/advertise/campaigns?c=${campaignId}`, genericBody: "An update on your Frenzsave ad.", tag: `ad-${campaignId}-${notice.kind}` },
      w.money ? "high" : "medium",
      w.money ? "premium" : "system",
      { type: w.money ? "payment_successful" : "system" },
    ).catch((e: unknown) => console.warn("[ads-platform] advertiser push failed", { campaignId, kind: notice.kind, error: String(e).slice(0, 160) }));
    // the same notice by email — the advertiser's contact address, else their account's
    let to = adv.contact_email && adv.contact_email.includes("@") ? adv.contact_email : null;
    if (!to) {
      const { data: p } = await db.from("profiles").select("email").eq("id", adv.user_id).maybeSingle();
      const e = (p as { email?: string | null } | null)?.email;
      to = typeof e === "string" && e.includes("@") ? e : null;
    }
    if (to) {
      const href = `${SITE_URL}/advertise/campaigns?c=${campaignId}`;
      await sendProductEmail(to, { subject: w.title, heading: esc(w.title), intro: esc(w.body), ctaLabel: "View campaign", ctaHref: href });
    }
  } catch (e) {
    console.warn("[ads-platform] advertiser notification failed", { campaignId, kind: notice.kind, error: String(e).slice(0, 160) });
  }
}
