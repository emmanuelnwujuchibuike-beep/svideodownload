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
