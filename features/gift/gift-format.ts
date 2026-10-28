/**
 * Frenz Gift Coin Part 4 — pure helpers for the gift sheet and bubble (testable, no React). Amounts are FGC MINOR units
 * (1 FGC = 100); every figure shown comes from the server — these only format it.
 */

/** 5000 → "50.00", 1234567 → "12,345.67" */
export function fgcText(minor: number): string {
  if (!Number.isFinite(minor)) return "—";
  const neg = minor < 0;
  const v = Math.abs(Math.trunc(minor));
  return `${neg ? "−" : ""}${Math.floor(v / 100).toLocaleString("en-US")}.${String(v % 100).padStart(2, "0")}`;
}

export type Rarity = "common" | "rare" | "epic" | "legendary";

/** Rare and above are tagged in the gallery (design/sticker-gifts.html). */
export const RARITY_TAG: Record<Rarity, { label: string; className: string } | null> = {
  common: null,
  rare: { label: "Rare", className: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
  epic: { label: "Epic", className: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  legendary: { label: "Legendary", className: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
};

/** The gallery's category chips: each category the published stickers use, in first-seen order. */
export function categoriesOf(stickers: { category: string | null }[]): string[] {
  const seen: string[] = [];
  for (const s of stickers) if (s.category && !seen.includes(s.category)) seen.push(s.category);
  return seen;
}

/** One idempotency key per intended gift (same sticker, recipient and chat), reused on every retry of it. */
export function giftKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `gift_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** What the member is told for each refusal reason the server can give (the server's own message is the fallback). */
export function giftFailureText(reason: string | null | undefined, serverText: string | null | undefined): string {
  switch (reason) {
    case "insufficient":
      return "Not enough available Gift Coins for this sticker. Convert Frenz Coins to Gift Coins in your wallet first.";
    case "sticker_changed":
      return "This sticker's price just changed. Check the new price and confirm again.";
    case "sticker_unavailable":
      return "This sticker isn't available any more.";
    case "gifting_not_configured":
    case "gifting_invalid":
      return "Sticker gifts aren't available yet.";
    case "authorization_failed":
    case "authorization_required":
      return "That PIN wasn't accepted. Nothing was sent.";
    case "blocked":
      return "You can't send a gift to this person.";
    // Part 6 (0296)
    case "daily_limit":
      return "That would pass your daily gifting limit. Nothing was sent.";
    case "quantity_invalid":
      return "Choose from 1 to 10 gifts.";
    case "note_too_long":
      return "Keep the note to 200 characters.";
    case "note_invalid":
      return "That note can't be sent. Use plain text on one line.";
    case "network":
      return "Couldn't reach the server. Nothing is known to have been sent — check the chat before trying again.";
    default:
      return serverText || "Couldn't send the gift. Nothing was taken.";
  }
}
