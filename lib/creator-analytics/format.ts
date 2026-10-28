/**
 * Creator analytics — periods and number formatting, shared by the server and the screens (client-safe, no I/O).
 *
 *   compact      1,300 → "1.3K", 907,000 → "907K" (at most one decimal, never "1.0K")
 *   coins        thousands separators, whole units ("8,360"); FGC and USD are minor units (÷ 100)
 *   pct          at most one decimal ("4.2%", "20%")
 *   change       always signed ("+12.4%", "−3%", "0%"); null when there is nothing to compare with
 */
export const PERIODS = ["7d", "30d", "90d", "1y"] as const;
export type AnalyticsPeriod = (typeof PERIODS)[number];
export const PERIOD_DAYS: Record<AnalyticsPeriod, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
export const PERIOD_LABEL: Record<AnalyticsPeriod, string> = { "7d": "7D", "30d": "30D", "90d": "90D", "1y": "1Y" };
export const PERIOD_CAPTION: Record<AnalyticsPeriod, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "1y": "Last 12 months" };
export const isPeriod = (v: unknown): v is AnalyticsPeriod => PERIODS.includes(v as AnalyticsPeriod);

const MINUS = "−";

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? MINUS : "";
  const unit = (v: number, s: string) => {
    const r = Math.round(v * 10) / 10;
    return `${sign}${r >= 100 || Number.isInteger(r) ? Math.round(r) : r.toFixed(1)}${s}`;
  };
  if (a >= 1e9) return unit(a / 1e9, "B");
  if (a >= 1e6) return unit(a / 1e6, "M");
  if (a >= 1e3) return unit(a / 1e3, "K");
  return `${sign}${Math.round(a)}`;
}

/** Whole coins from minor units (FGC and USD cents are both ×100), with thousands separators. */
export function coins(minor: number | null | undefined): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "—";
  return Math.round(minor / 100).toLocaleString("en-US");
}

/** "$12.40" from USD cents. */
export function usd(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const v = cents / 100;
  return `${v < 0 ? MINUS : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: v % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const r = Math.round(v * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}%`;
}

/** % change from `before` to `now`; null when before is 0 or unknown (no honest comparison). */
export function changePct(now: number, before: number | null | undefined): number | null {
  if (before === null || before === undefined || !Number.isFinite(before) || before <= 0) return null;
  return ((now - before) / before) * 100;
}

export function signed(v: number | null | undefined, unit = "%"): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  const r = Math.round(v * 10) / 10;
  const body = `${Number.isInteger(Math.abs(r)) ? Math.abs(r) : Math.abs(r).toFixed(1)}${unit}`;
  return r > 0 ? `+${body}` : r < 0 ? `${MINUS}${body}` : `0${unit}`;
}

/** "+318" / "−4" for counts. */
export function signedCount(v: number): string {
  return v > 0 ? `+${v.toLocaleString("en-US")}` : v < 0 ? `${MINUS}${Math.abs(v).toLocaleString("en-US")}` : "0";
}

/** "Oct 21" for a YYYY-MM-DD day. */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Group a daily series into `n` roughly equal buckets (summed), keeping the first day of each as its label. */
export function bucket<T extends { day: string }>(rows: T[], n: number, value: (r: T) => number): { day: string; value: number }[] {
  if (rows.length <= n) return rows.map((r) => ({ day: r.day, value: value(r) }));
  const size = Math.ceil(rows.length / n);
  const out: { day: string; value: number }[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    out.push({ day: part[0]!.day, value: part.reduce((s, r) => s + value(r), 0) });
  }
  return out;
}

/** The 6 four-hour blocks of the heatmap, in the creator's local time. */
export const BLOCKS = ["12a", "4a", "8a", "12p", "4p", "8p"] as const;
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Readable names for the view sources post_views records (an unknown one shows as itself). */
export const SOURCE_LABEL: Record<string, string> = {
  for_you: "For You",
  following: "Following",
  recent: "Recent",
  trending: "Trending",
  reels: "Reels",
  feed: "Feed",
  post_page: "Post page",
  search: "Search",
  profile: "Profile",
  collection: "Collection",
  untagged: "Other",
};

/** Feature-of-the-month names (the keys creator_feature_usage answers with). */
export const FEATURE_LABEL: Record<string, string> = {
  sticker_gifts: "Sticker gifts",
  exclusive: "Exclusive subscriptions",
  ai_creation: "AI creation",
  sharing: "Sharing",
  reposts: "Reposts",
  comments: "Comments",
  stories: "Stories",
  wallpapers: "Wallpapers",
  downloader: "Downloader",
  chat: "Chat",
};
