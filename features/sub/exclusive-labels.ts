import { usd } from "@/lib/creator/membership/engine";
import { inRenewWindow } from "@/lib/sub/lifecycle";

/**
 * The words on Exclusive feed cards (Part 15) — pure, so every state is tested. Nothing here
 * decides access: these only describe what the server already decided.
 */

/** One way to say what a post holds: "1 photo", "4 photos", "1 video", "3 items" (mixed or all video). */
export function itemsLabel(items: number, hasVideo: boolean): string {
  if (items <= 0) return "Exclusive post";
  if (!hasVideo) return items === 1 ? "1 photo" : `${items} photos`;
  return items === 1 ? "1 video" : `${items} items`;
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const longDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

export type MembershipChip = { tone: "active" | "ending" | "ended"; text: string; label: string };

/**
 * The membership chip on a subscribed creator's card, from the server's period_end. No date →
 * a plain "Subscribed" (never an invented one). A date already past → "Access ended": the next
 * page (or opening the post) asks the server again, and the chip never claims access it denies.
 */
export function membershipChip(accessUntil: string | null | undefined, now = Date.now()): MembershipChip | null {
  if (accessUntil === undefined) return null;
  if (!accessUntil || Number.isNaN(Date.parse(accessUntil))) return { tone: "active", text: "Subscribed", label: "Subscribed" };
  if (Date.parse(accessUntil) <= now) return { tone: "ended", text: "Access ended", label: `Your access ended on ${longDay(accessUntil)}` };
  if (inRenewWindow(accessUntil, now)) return { tone: "ending", text: `Ends ${day(accessUntil)}`, label: `Subscribed — access ends ${longDay(accessUntil)}. It doesn't renew automatically.` };
  return { tone: "active", text: "Subscribed", label: `Subscribed — access until ${longDay(accessUntil)}` };
}

/**
 * A subscription's price on a feed card, as the server quoted it: the total the subscriber pays.
 * The breakdown (creator's full price + purchase fee) is shown at checkout only (owner, 2026-10-17).
 */
export function priceLine(c: { totalCents: number; periodDays: number }): string {
  return `${usd(c.totalCents)} for ${c.periodDays} days`;
}
