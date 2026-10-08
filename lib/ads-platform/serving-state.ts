/**
 * Part 5 — the browser's serving STATE around the cached payload.
 *
 * Everything here is pure or touches only small session keys, so the rules the
 * renderers follow are testable without a DOM:
 *
 *   · `pageForPath`      which content area a route is (the engine's AdPageContext)
 *   · `poolFor`          stage 2 (time + page) minus creatives that failed THIS session
 *   · `nextFromPool`     the next interstitial / reward video, never the one shown last
 *   · `mayShowAgain`     the format's admin frequency gap (`min_gap_seconds`)
 *   · `claimMoment`      (re-exported from ./moment-events) one ad per moment: a paid campaign that takes a moment makes the
 *                        network unit for the SAME moment stand down (never two
 *                        full-screen ads for one finished download)
 *
 * Nothing here decides whether a campaign is active, paid or valid — that was
 * decided on the server (`eligibleForPlacement`) and the browser only narrows.
 */

import type { AdPageContext } from "./catalog";
import { pageMatches, type EligibleAd, type FormatRules } from "./eligibility";
import { __resetMomentClaims } from "./moment-events";
import { pickNextNoRepeat } from "./rotation";
import type { ServingPayload } from "./serving-payload";

/* ─────────────────────────────── pages ─────────────────────────────── */

// `pageForPath` lives in ./pages (tiny — the top banner imports it on every content page).
export { pageForPath } from "./pages";

/** Stage 2 for a page that may be null (see `pageForPath`). */
function servableOn(ad: EligibleAd, placementPages: readonly string[], page: AdPageContext | null, now: number): boolean {
  if (page === null) {
    if (!placementPages.includes("all_pages")) return false;
    if (ad.pages.length > 0 && !ad.pages.includes("all_pages")) return false;
  } else {
    if (!pageMatches(placementPages, page)) return false;
    if (ad.pages.length > 0 && !pageMatches(ad.pages, page)) return false;
  }
  return Date.parse(ad.start) <= now && now < Date.parse(ad.end);
}

/* ─────────────────────────── failed creatives ─────────────────────────── */

/**
 * Creatives whose media failed to load in THIS document. Never retried, never
 * shown again this session (§25) — memory only, so a reload gives a fixed file
 * another chance. Small by construction: at most the pool sizes.
 */
const failed = new Set<string>();
const failedListeners = new Set<() => void>();

export function markCreativeFailed(creativeId: string): void {
  if (failed.has(creativeId)) return;
  failed.add(creativeId);
  for (const l of failedListeners) l();
}

export function creativeFailed(creativeId: string): boolean {
  return failed.has(creativeId);
}

export function onCreativeFailed(listener: () => void): () => void {
  failedListeners.add(listener);
  return () => failedListeners.delete(listener);
}

/* ─────────────────────────────── the pool ─────────────────────────────── */

export interface Pool {
  ads: EligibleAd[];
  rules: FormatRules | null;
}

const EMPTY: Pool = { ads: [], rules: null };

/**
 * The ads a placement may show on this page now: the server's pool, narrowed
 * by time and page, minus anything that failed this session. A video longer
 * than the format's CURRENT limit is dropped here too — the server already
 * refused it, this only means a stale cached payload can never outrun an
 * admin who just lowered the limit.
 */
export function poolFor(payload: ServingPayload | null, placement: string, page: AdPageContext | null, now: number = Date.now()): Pool {
  const p = payload?.enabled ? payload.placements[placement] : undefined;
  if (!p) return EMPTY;
  const max = p.rules.maxDurationSeconds;
  const ads = p.ads.filter(
    (ad) =>
      !failed.has(ad.cr) &&
      servableOn(ad, p.pages, page, now) &&
      (ad.mediaType !== "video" || max === null || (ad.duration !== null && ad.duration > 0 && ad.duration <= max)),
  );
  return ads.length ? { ads, rules: p.rules } : { ads: [], rules: p.rules };
}

/* ─────────────────────── no-repeat + frequency (session) ─────────────────────── */

const LAST_KEY = "frenz.ads.self.last.v1";

interface Last {
  /** the creative shown last */
  cr: string;
  /** when it was shown (ms) */
  at: number;
}

function readLast(): Record<string, Last> {
  try {
    const raw = sessionStorage.getItem(LAST_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Record<string, Last>) : {};
  } catch {
    return {};
  }
}

/** Remember what a placement showed — one small entry per placement, never a history. */
export function recordShown(placement: string, creativeId: string, now: number = Date.now()): void {
  const all = readLast();
  all[placement] = { cr: creativeId, at: now };
  try {
    sessionStorage.setItem(LAST_KEY, JSON.stringify(all));
  } catch {
    /* private mode: the in-page state still prevents an immediate repeat */
  }
  memoryLast[placement] = { cr: creativeId, at: now };
}

/** Fallback for a browser that refuses sessionStorage. */
const memoryLast: Record<string, Last> = {};

function lastFor(placement: string): Last | null {
  return readLast()[placement] ?? memoryLast[placement] ?? null;
}

/** The next ad for a one-at-a-time placement: never the one it showed last while another exists. */
export function nextFromPool(placement: string, pool: readonly EligibleAd[], random: () => number = Math.random): EligibleAd | null {
  return pickNextNoRepeat(pool, lastFor(placement)?.cr ?? null, random);
}

/** The format's frequency gap: may this placement show again yet? */
export function mayShowAgain(placement: string, rules: FormatRules | null, now: number = Date.now()): boolean {
  const gap = rules?.minGapSeconds ?? 0;
  const last = lastFor(placement);
  return !last || gap <= 0 || now - last.at >= gap * 1000;
}

/* ─────────────────────────────── moments ─────────────────────────────── */

// The claim lives in ./moment-events (tiny — the network triggers on every page import it).
export { claimMoment, momentClaimed, MOMENT_CLAIM_MS, type AdMoment } from "./moment-events";
/** Tests only. */
export function __resetServingState(): void {
  failed.clear();
  failedListeners.clear();
  for (const k of Object.keys(memoryLast)) delete memoryLast[k];
  __resetMomentClaims();
  try {
    sessionStorage.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
}
