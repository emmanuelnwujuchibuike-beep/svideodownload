import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sendProductEmail } from "@/lib/email/resend";
import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import { SITE_URL } from "@/lib/site";

import { noticeAsDisplayed } from "./notice-display";

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
  | { kind: "removed"; reason: string | null; refundOwed: boolean }
  /* 0240: guaranteed views */
  | { kind: "target_reached"; views: number }
  | { kind: "delivery_extended"; remaining: number; endAt: string | null }
  | { kind: "delivery_shortfall"; shortfall: number; refundOwed: boolean }
  | { kind: "deadline_soon"; remaining: number; endAt: string | null; freeExtension: boolean }
  /* 0241: a live fixed-period campaign, a day before its end */
  | { kind: "expiring_soon"; endAt: string | null };

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
    case "target_reached":
      return { title: "Views target reached", body: `“${name}” delivered all ${n.views.toLocaleString("en-US")} views and has stopped. It won't renew or charge you again — launch another campaign any time.`, money: false };
    case "delivery_extended":
      return { title: "Delivery extended, free", body: `“${name}” has ${n.remaining.toLocaleString("en-US")} views to go, so it keeps running${day(n.endAt) ? ` until ${day(n.endAt)}` : ""} at no extra charge.`, money: false };
    case "expiring_soon":
      return { title: "Your ad ends soon", body: `“${name}” stops showing${day(n.endAt) ? ` on ${day(n.endAt)}` : " soon"}. Extend it from your campaign page to keep it running.`, money: false };
    case "deadline_soon":
      return {
        title: "Planned period ends soon",
        body: `“${name}” has ${n.remaining.toLocaleString("en-US")} views to go${day(n.endAt) ? ` and its planned period ends ${day(n.endAt)}` : ""}.${n.freeExtension ? " If it ends short, delivery continues free until your target is met." : " If it ends short, the undelivered share is refunded."}`,
        money: false,
      };
    case "delivery_shortfall":
      return { title: "Delivery ended short", body: `“${name}” ended ${n.shortfall.toLocaleString("en-US")} views short of its target.${n.refundOwed ? " The undelivered share of your payment will be refunded." : ""}`, money: n.refundOwed };
  }
}

/**
 * 0241 (owner 2026-10-12): a member asked to be told when a full placement has
 * a free slot — push AND email, once (the waitlist row is claimed before this
 * runs). Best effort, each channel on its own, like notifyAdvertiser.
 */
export async function notifySlotOpen(db: SupabaseClient, userId: string, placementName: string): Promise<void> {
  const title = "An ad slot is open";
  const body = `A slot is free in “${placementName}”. Slots go to whoever pays first — create your campaign now.`;
  const href = `${SITE_URL}/advertise/create`;
  try {
    await sendSmartPush(
      userId,
      { title, body, url: "/advertise/create", genericBody: "An ad slot you asked about is open.", tag: `ad-slot-${placementName}` },
      "medium",
      "system",
      { type: "system" },
    ).catch((e: unknown) => console.warn("[ads-platform] slot push failed", { error: String(e).slice(0, 160) }));
    const { data: p } = await db.from("profiles").select("email").eq("id", userId).maybeSingle();
    const to = (p as { email?: string | null } | null)?.email;
    if (typeof to === "string" && to.includes("@")) {
      await sendProductEmail(to, { subject: title, heading: esc(title), intro: esc(body), ctaLabel: "Create your campaign", ctaHref: href });
    }
  } catch (e) {
    console.warn("[ads-platform] slot notification failed", { error: String(e).slice(0, 160) });
  }
}

/** The campaign name is the advertiser's own text — it goes into HTML escaped. */
function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const VIEW_NOTICES = new Set<AdNotice["kind"]>(["delivery_extended", "deadline_soon", "delivery_shortfall"]);

async function viewsDisplay(db: SupabaseClient, campaignId: string): Promise<[number | null, number]> {
  try {
    const { data, error } = await db.from("ad_campaigns").select("target_views, stats_multiplier").eq("id", campaignId).maybeSingle();
    if (error || !data) return [null, 1];
    const r = data as { target_views?: number | null; stats_multiplier?: number | null };
    return [r.target_views ?? null, Number(r.stats_multiplier ?? 1) || 1];
  } catch {
    return [null, 1];
  }
}

export async function notifyAdvertiser(db: SupabaseClient, campaignId: string, notice: AdNotice): Promise<void> {
  try {
    const { data } = await db.from("ad_campaigns").select("name, advertisers!inner(user_id, contact_email)").eq("id", campaignId).maybeSingle();
    const row = data as { name?: string; advertisers?: { user_id?: string; contact_email?: string | null } | { user_id?: string; contact_email?: string | null }[] } | null;
    const adv = Array.isArray(row?.advertisers) ? row?.advertisers[0] : row?.advertisers;
    if (!row || !adv?.user_id) return;
    // view counts as the dashboard shows them (its x10 sample mode), read on their own so a
    // database without those columns still sends the notice unchanged
    const shown = VIEW_NOTICES.has(notice.kind) ? noticeAsDisplayed(notice, ...(await viewsDisplay(db, campaignId))) : notice;
    if (!shown) return;
    notice = shown;
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
