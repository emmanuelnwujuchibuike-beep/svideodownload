import { DEFAULT_LOCALE, getLocale, type LocaleCode } from "./locales";

/**
 * Regional Intelligence Engine™ — formatting.
 *
 * ── Useful before anything is translated ──────────────────────────────────────
 *
 * Formatting and translation are independent, and conflating them is why sites
 * show "1,234.5" and "07/04" to people who read those as "1.234,5" and the fourth
 * of July when they meant the seventh of April. A date read wrongly is worse than
 * a date in the wrong language — the second is obviously foreign, the first is
 * silently incorrect.
 *
 * So this ships now, keyed on the visitor's locale, with zero translated strings
 * required. It is the half of internationalisation that pays off immediately.
 *
 * ── Built on Intl, not a library ──────────────────────────────────────────────
 *
 * `Intl` is in every browser and in Node, carries the CLDR data already, and costs
 * no bundle bytes. A formatting library here would ship locale tables the platform
 * already has — the exact "shipping bytes for something we already have" mistake
 * the perf budget exists to catch.
 *
 * Formatters are cached because constructing `Intl.DateTimeFormat` is genuinely
 * expensive relative to using one, and these run in list renders.
 */

function tag(locale: LocaleCode): string {
  return getLocale(locale)?.bcp47 ?? DEFAULT_LOCALE;
}

/* Keyed by locale + options so each distinct configuration is built once. */
const dateCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();
const relativeCache = new Map<string, Intl.RelativeTimeFormat>();

function dateFormatter(locale: LocaleCode, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = dateCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(tag(locale), options);
    dateCache.set(key, formatter);
  }
  return formatter;
}

function numberFormatter(locale: LocaleCode, options: Intl.NumberFormatOptions) {
  const key = `${locale}:${JSON.stringify(options)}`;
  let formatter = numberCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(tag(locale), options);
    numberCache.set(key, formatter);
  }
  return formatter;
}

/* ----------------------------------- dates ----------------------------------- */

export function formatDate(
  value: Date | string | number,
  locale: LocaleCode = DEFAULT_LOCALE,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return dateFormatter(locale, options).format(new Date(value));
}

export function formatTime(
  value: Date | string | number,
  locale: LocaleCode = DEFAULT_LOCALE,
): string {
  // No hour12 override: whether a locale uses a 12- or 24-hour clock is exactly
  // the kind of regional fact Intl already knows and we should not second-guess.
  return dateFormatter(locale, { timeStyle: "short" }).format(new Date(value));
}

/**
 * Relative time — "3 days ago".
 *
 * Chooses the largest unit that still reads naturally, because "72 hours ago" is
 * technically correct and nobody says it.
 */
export function formatRelative(
  value: Date | string | number,
  locale: LocaleCode = DEFAULT_LOCALE,
  now: Date = new Date(),
): string {
  let formatter = relativeCache.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(tag(locale), { numeric: "auto" });
    relativeCache.set(locale, formatter);
  }

  const deltaSeconds = (new Date(value).getTime() - now.getTime()) / 1000;
  const abs = Math.abs(deltaSeconds);

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];

  for (const [unit, seconds] of units) {
    if (abs >= seconds) return formatter.format(Math.round(deltaSeconds / seconds), unit);
  }
  return formatter.format(Math.round(deltaSeconds), "second");
}

/* ---------------------------------- numbers ---------------------------------- */

export function formatNumber(
  value: number,
  locale: LocaleCode = DEFAULT_LOCALE,
  options: Intl.NumberFormatOptions = {},
): string {
  return numberFormatter(locale, options).format(value);
}

/**
 * Compact counts — "1.2K".
 *
 * Used for engagement figures, where the exact number is noise and the magnitude
 * is the message. Note this formats a REAL count; it is not a licence to display
 * a rounded-up impression of one.
 */
export function formatCompact(value: number, locale: LocaleCode = DEFAULT_LOCALE): string {
  return numberFormatter(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/**
 * Currency.
 *
 * Currency is an explicit argument with no default, deliberately. Inferring it
 * from locale is a classic and expensive bug: a French-speaking visitor in
 * Senegal is not paying in euros, and guessing wrong on a price is worse than
 * showing a currency code they have to read. Price data must say what it is
 * denominated in.
 */
export function formatCurrency(
  value: number,
  currency: string,
  locale: LocaleCode = DEFAULT_LOCALE,
): string {
  return numberFormatter(locale, { style: "currency", currency }).format(value);
}

/** File sizes. Binary units, because that is what operating systems report. */
export function formatBytes(bytes: number, locale: LocaleCode = DEFAULT_LOCALE): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const formatted = formatNumber(value, locale, {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  });
  return `${formatted} ${units[unit]}`;
}

/** Media duration as h:mm:ss / m:ss. Positional, so it needs no translation. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/* ----------------------------------- lists ----------------------------------- */

/**
 * "A, B and C" — with the locale's own conjunction and separators.
 *
 * Worth using rather than `join(", ")` because the separator is not universal:
 * Arabic uses a different comma character entirely, and hand-joining produces
 * punctuation that looks wrong to a reader without them being able to say why.
 */
export function formatList(
  items: string[],
  locale: LocaleCode = DEFAULT_LOCALE,
  type: "conjunction" | "disjunction" = "conjunction",
): string {
  return new Intl.ListFormat(tag(locale), { style: "long", type }).format(items);
}
