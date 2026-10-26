/**
 * Frenz Coin display helpers (pure). Every amount is INTEGER US cents from the server; 1 Frenz Coin = $1 = 100 cents
 * (frenzCoin.centsPerCoin). Nothing here decides a fee, a payout or a balance — those come from the API.
 */

const COIN_FMT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1,234.56" — coins, from cents (1 coin = 100 cents unless the server says otherwise). */
export function coins(cents: number, centsPerCoin = 100): string {
  return COIN_FMT.format(Math.trunc(cents) / centsPerCoin);
}

/**
 * "FC 1,234.56" — Frenz Coin written as a currency: the code first, the way currency codes are written ("CHF 24.00"),
 * joined by a no-break space so the two never wrap apart. Plain text, for rows, labels and screen readers.
 */
export function fc(cents: number, centsPerCoin = 100): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}FC ${coins(Math.abs(cents), centsPerCoin)}`;
}

/** "+FC 50.00" / "−FC 56.00" — a signed amount for activity rows. */
export function signedFc(cents: number, centsPerCoin = 100): string {
  if (cents === 0) return fc(0, centsPerCoin);
  return `${cents > 0 ? "+" : "−"}${fc(Math.abs(cents), centsPerCoin)}`;
}

/** "$1,234.56" — the USD value of cents. */
export function usd(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${COIN_FMT.format(Math.abs(Math.trunc(cents)) / 100)}`;
}

/** "$1" / "$1.50" / "$1,000" — a fee or a threshold in a sentence: no ".00" on whole dollars. */
export function dollars(cents: number): string {
  const c = Math.abs(Math.trunc(cents));
  return `$${c % 100 === 0 ? (c / 100).toLocaleString("en-US") : COIN_FMT.format(c / 100)}`;
}

/** The transfer fee rules the admin set (frenzCoin.transfers), as the wallet summary sends them. */
export interface TransferFeeRules {
  percentBp: number;
  lowThresholdCents: number;
  highThresholdCents: number;
  flatBelowCents: number;
  flatMidCents: number;
  flatAboveCents: number;
}

/**
 * The transfer fee rule in words, built from the ADMIN'S numbers (owner, 2026-10-26: the fee card "should not be
 * hardcoded, it should change with whatever is set in admin dashboard"). Words only — the figure a member pays is
 * still priced by the server at review. "10% plus $1 under $100, 10% from $100 to $500, and 10% plus $5 above $500".
 */
export function transferFeeWords(f: TransferFeeRules): string {
  const pct = f.percentBp > 0 ? `${Number((f.percentBp / 100).toFixed(2))}%` : "";
  const part = (flat: number) => (pct && flat > 0 ? `${pct} plus ${dollars(flat)}` : pct || (flat > 0 ? dollars(flat) : "no fee"));
  const [below, mid, above] = [part(f.flatBelowCents), part(f.flatMidCents), part(f.flatAboveCents)];
  if (below === mid && mid === above) return `${below} on every transfer`;
  const low = dollars(f.lowThresholdCents);
  const high = dollars(f.highThresholdCents);
  const middle = f.lowThresholdCents === f.highThresholdCents ? `${mid} at ${low}` : `${mid} from ${low} to ${high}`;
  return `${below} under ${low}, ${middle}, and ${above} above ${high}`;
}

/** A withdrawal fee rule in words, from the admin's numbers: "6%", "6% + $0.50", "$1", "no fee". */
export function withdrawalFeeRule(percentBp: number, flatCents: number): string {
  const pct = percentBp > 0 ? `${Number((percentBp / 100).toFixed(2))}%` : "";
  if (pct && flatCents > 0) return `${pct} + ${dollars(flatCents)}`;
  return pct || (flatCents > 0 ? dollars(flatCents) : "no fee");
}

const NAIRA_RATE = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The payout rate on the review step, from the server's preview: a fixed rate is THE rate ("₦1,550.00 per $1"); a
 * market rate is today's, re-read when paid ("≈ ₦1,548.20 per $1, today's market rate").
 */
export function payoutRateLine(p: { source: "fixed" | "market"; nairaPerUsd: number }): string {
  const rate = `${NAIRA_RATE.format(p.nairaPerUsd)} per $1`;
  return p.source === "fixed" ? rate : `≈ ${rate}, today's market rate`;
}

/** The whole notice: how the fee works, or that there is none. */
export function transferFeeNotice(f: TransferFeeRules): string {
  const free = f.percentBp <= 0 && f.flatBelowCents <= 0 && f.flatMidCents <= 0 && f.flatAboveCents <= 0;
  if (free) return "Transfers are free — they receive the full amount.";
  return `Fees are worked out when you review: ${transferFeeWords(f)}. The fee is added on top — they receive the full amount.`;
}

/** "+50.00" / "−56.00" — a signed coin amount for activity rows. */
export function signedCoins(cents: number, centsPerCoin = 100): string {
  if (cents === 0) return "0.00";
  return `${cents > 0 ? "+" : "−"}${coins(Math.abs(cents), centsPerCoin)}`;
}

/** The whole and fractional parts of a coin amount, for the large balance figure ("24,850" and ".00"). */
export function coinParts(cents: number, centsPerCoin = 100): { whole: string; fraction: string } {
  const s = coins(cents, centsPerCoin);
  const dot = s.lastIndexOf(".");
  return { whole: s.slice(0, dot), fraction: s.slice(dot) };
}

/**
 * What a member typed, as integer cents of coins — "50", "50.5", "1,250.75" → 5000, 5050, 125075. Anything else (more
 * than two decimals, letters, empty, zero or negative) → null. String arithmetic only: no floating point.
 */
export function parseCoinInput(raw: string, centsPerCoin = 100): number | null {
  const s = raw.replace(/[,\s]/g, "");
  const m = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? "").padEnd(2, "0") || "0");
  if (centsPerCoin !== 100) return null;
  const cents = whole * 100 + frac;
  return cents > 0 ? cents : null;
}

/** "120 368 2058" — a 10-digit wallet number, grouped like the design. */
export function walletNumber(n: string | null | undefined): string {
  const d = (n ?? "").replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : d;
}

/** Digits only — what the API takes for a wallet number. */
export const walletDigits = (s: string) => s.replace(/\D/g, "");

/** "Today", "Yesterday", or "Oct 22" — the activity list's day groups (local time). */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** "10:42 AM" */
export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** "Oct 25, 2026 · 10:58 AM" */
export const dateTimeLabel = (iso: string) => `${new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${timeLabel(iso)}`;

/** "in 2 days" / "in 5 hours" / "any moment now" — a hold's release time, relative. */
export function releaseLabel(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (!(ms > 0)) return "any moment now";
  const h = Math.ceil(ms / 3_600_000);
  if (h < 24) return `in ${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? "" : "s"}`;
}

/** The deposit hold in words: "1 hour", "3 days", or null when there is none (spendable right away). */
export function holdLabel(hours: number): string | null {
  if (!(hours > 0)) return null;
  if (hours % 24 === 0) return `${hours / 24} day${hours === 24 ? "" : "s"}`;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Group items by `dayLabel`, preserving order. */
export function groupByDay<T extends { at: string }>(items: readonly T[], now = new Date()): { label: string; rows: T[] }[] {
  const out: { label: string; rows: T[] }[] = [];
  for (const it of items) {
    const label = dayLabel(it.at, now);
    const last = out[out.length - 1];
    if (last && last.label === label) last.rows.push(it);
    else out.push({ label, rows: [it] });
  }
  return out;
}

/** A fresh idempotency key (8–80 of [A-Za-z0-9_-], the API's shape). */
export function newKey(prefix: string): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${id}`.slice(0, 80);
}
