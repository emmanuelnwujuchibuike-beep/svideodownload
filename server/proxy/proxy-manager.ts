import { Redis } from "@upstash/redis";
import { ProxyAgent } from "undici";

import type { PlatformId } from "@/types";

/**
 * Smart residential-proxy manager.
 *
 * Strategy: try DIRECT (cheap VPS bandwidth) first; only fall back to the
 * residential proxy when a platform actually blocks us (403/429/challenge), and
 * only for platforms configured as proxy-eligible, and only while under the
 * monthly bandwidth budget. The proxy is used for small extraction requests —
 * NEVER for streaming video bytes — so consumption stays tiny.
 *
 * All knobs are environment-driven (see .env.example).
 */

function bool(v: string | undefined, def: boolean): boolean {
  if (v == null || v === "") return def;
  return !["false", "0", "off", "no"].includes(v.toLowerCase());
}
function num(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function list(v: string | undefined, def: PlatformId[]): PlatformId[] {
  if (!v) return def;
  return v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as PlatformId[];
}

const ENABLED = bool(process.env.PROXY_ENABLED, false);
const HOST = process.env.PROXY_HOST || "";
const PORT = process.env.PROXY_PORT || "";
const USER = process.env.PROXY_USERNAME || "";
const PASS = process.env.PROXY_PASSWORD || "";
const PROTOCOL = process.env.PROXY_PROTOCOL || "http";
const FALLBACK_ONLY = bool(process.env.PROXY_FALLBACK_ONLY, true);
const LIMIT_GB = num(process.env.PROXY_BANDWIDTH_LIMIT_GB, 2);
const COST_PER_GB = num(process.env.PROXY_COST_PER_GB, 0); // optional, for $ estimate

// Platforms that MAY use the proxy as a fallback.
const PROXY_PLATFORMS = list(process.env.PROXY_PLATFORMS, [
  "instagram",
  "facebook",
  "twitter",
  "snapchat",
  "linkedin",
]);
// Platforms that ALWAYS stay direct (never proxy), even on a block.
const DIRECT_PLATFORMS = list(process.env.PROXY_DIRECT_PLATFORMS, [
  "tiktok",
  "pinterest",
  "youtube",
]);

// Backward-compat: a single EXTRACTOR_PROXY URL still works if the structured
// PROXY_* vars aren't set.
const LEGACY_PROXY_URL = process.env.EXTRACTOR_PROXY || "";

const LIMIT_BYTES = Math.max(0, LIMIT_GB) * 1_000_000_000;

function proxyUrl(): string {
  if (HOST && PORT) {
    const auth = USER
      ? `${encodeURIComponent(USER)}:${encodeURIComponent(PASS)}@`
      : "";
    return `${PROTOCOL}://${auth}${HOST}:${PORT}`;
  }
  return LEGACY_PROXY_URL;
}

export const proxyConfigured = ENABLED && (!!(HOST && PORT) || !!LEGACY_PROXY_URL);

let agent: ProxyAgent | null = null;
/** Shared undici proxy dispatcher, or null when the proxy isn't configured. */
export function proxyDispatcher(): ProxyAgent | null {
  if (!proxyConfigured) return null;
  if (!agent) agent = new ProxyAgent(proxyUrl());
  return agent;
}

/** yt-dlp `--proxy` args (empty when the proxy isn't configured). */
export function ytdlpProxyArgs(): string[] {
  return proxyConfigured ? ["--proxy", proxyUrl()] : [];
}

/* --------------------------------------------------------------------------
 * Usage tracking (Upstash Redis with in-memory fallback)
 * ------------------------------------------------------------------------ */

const hasRedis =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = hasRedis ? Redis.fromEnv() : null;
const mem = new Map<string, number>();

const month = () => new Date().toISOString().slice(0, 7); // YYYY-MM
const day = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

async function incr(key: string, by: number): Promise<void> {
  if (by <= 0) return;
  if (redis) {
    try {
      await redis.incrby(key, Math.round(by));
    } catch {
      /* ignore */
    }
  } else {
    mem.set(key, (mem.get(key) || 0) + by);
  }
}
async function read(key: string): Promise<number> {
  if (redis) {
    try {
      return Number(await redis.get(key)) || 0;
    } catch {
      return 0;
    }
  }
  return mem.get(key) || 0;
}

export async function recordRequest(viaProxy: boolean): Promise<void> {
  await incr(`proxy:req:${viaProxy ? "proxy" : "direct"}`, 1);
}

/** Records bandwidth attributed to the residential proxy (extraction bytes). */
export async function recordProxyBytes(
  platform: PlatformId,
  bytes: number,
): Promise<void> {
  if (bytes <= 0) return;
  const m = month();
  await incr(`proxy:bw:${m}`, bytes);
  await incr(`proxy:bw:${platform}:${m}`, bytes);
  await incr(`proxy:bw:day:${day()}`, bytes);
}

async function monthlyBytes(): Promise<number> {
  return read(`proxy:bw:${month()}`);
}

/** True while the proxy is configured and under the monthly bandwidth budget. */
export async function withinBudget(): Promise<boolean> {
  // Treat 0 / invalid limit as unlimited (never accidentally disable the proxy).
  if (!Number.isFinite(LIMIT_BYTES) || LIMIT_BYTES <= 0) return true;
  return (await monthlyBytes()) < LIMIT_BYTES;
}

/* --------------------------------------------------------------------------
 * Routing decisions
 * ------------------------------------------------------------------------ */

export function isProxyEligible(platform: PlatformId): boolean {
  if (!proxyConfigured) return false;
  if (DIRECT_PLATFORMS.includes(platform)) return false;
  return PROXY_PLATFORMS.includes(platform);
}

/**
 * Should this attempt use the proxy? `attempt` is 0 for the first (direct) try.
 * With PROXY_FALLBACK_ONLY (default) the proxy is never used on attempt 0.
 */
export async function shouldUseProxy(
  platform: PlatformId,
  attempt: number,
): Promise<boolean> {
  if (!isProxyEligible(platform)) return false;
  if (FALLBACK_ONLY && attempt === 0) return false;
  return withinBudget();
}

/* --------------------------------------------------------------------------
 * Block / challenge detection
 * ------------------------------------------------------------------------ */

export function isBlockedStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    status === 451 || // unavailable for legal reasons / geo
    status === 503
  );
}

/** Heuristic: does this (HTML) body look like a bot/login/geo wall? */
export function looksLikeChallenge(body: string): boolean {
  const b = body.slice(0, 6000).toLowerCase();
  return (
    b.includes("captcha") ||
    b.includes("are you a robot") ||
    b.includes("/challenge") ||
    b.includes("slardarwaf") ||
    b.includes("unusual traffic") ||
    b.includes("/accounts/login") ||
    (b.includes("login required") && b.length < 6000)
  );
}

/** True if a yt-dlp stderr string indicates a block we could retry via proxy. */
export function ytdlpStderrIsBlock(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes("http error 403") ||
    s.includes("http error 429") ||
    s.includes("http error 401") ||
    s.includes("sign in to confirm") ||
    s.includes("login required") ||
    s.includes("rate-limit") ||
    s.includes("rate limit") ||
    s.includes("geo restrict") ||
    s.includes("not available in your") ||
    s.includes("blocked")
  );
}

/* --------------------------------------------------------------------------
 * Monitoring / cost
 * ------------------------------------------------------------------------ */

export interface ProxyUsage {
  configured: boolean;
  fallbackOnly: boolean;
  month: string;
  bytesThisMonth: number;
  gbThisMonth: number;
  limitGb: number;
  percentOfLimit: number;
  remainingGb: number;
  estimatedCostUsd: number | null;
  alertLevel: 0 | 50 | 75 | 90 | 100;
  requests: { proxy: number; direct: number };
  perPlatform: Record<string, number>;
}

export async function getProxyUsage(): Promise<ProxyUsage> {
  const m = month();
  const bytes = await monthlyBytes();
  const gb = bytes / 1e9;
  const percent = LIMIT_GB > 0 ? Math.min(100, (gb / LIMIT_GB) * 100) : 0;
  const [proxyReq, directReq] = await Promise.all([
    read("proxy:req:proxy"),
    read("proxy:req:direct"),
  ]);

  const perPlatform: Record<string, number> = {};
  for (const p of [...PROXY_PLATFORMS, ...DIRECT_PLATFORMS]) {
    const b = await read(`proxy:bw:${p}:${m}`);
    if (b > 0) perPlatform[p] = b;
  }

  const alertLevel: ProxyUsage["alertLevel"] =
    percent >= 100 ? 100 : percent >= 90 ? 90 : percent >= 75 ? 75 : percent >= 50 ? 50 : 0;

  return {
    configured: proxyConfigured,
    fallbackOnly: FALLBACK_ONLY,
    month: m,
    bytesThisMonth: bytes,
    gbThisMonth: Number(gb.toFixed(3)),
    limitGb: LIMIT_GB,
    percentOfLimit: Number(percent.toFixed(1)),
    remainingGb: Number(Math.max(0, LIMIT_GB - gb).toFixed(3)),
    estimatedCostUsd: COST_PER_GB > 0 ? Number((gb * COST_PER_GB).toFixed(2)) : null,
    alertLevel,
    requests: { proxy: proxyReq, direct: directReq },
    perPlatform,
  };
}
