import { ProxyAgent } from "undici";

import {
  isBlockedStatus,
  looksLikeChallenge,
  proxyConfigured,
  proxyDispatcher,
  recordProxyBytes,
  recordRequest,
  shouldUseProxy,
} from "@/server/proxy/proxy-manager";
import type { PlatformId } from "@/types";

import { cookieHeaderFor } from "./cookies";

/**
 * Smart extractor fetch: DIRECT first (cheap), residential proxy only as a
 * fallback when the platform blocks us — by HTTP status (403/429) OR by serving
 * a 200 login/WAF/challenge page (Instagram, Facebook, TikTok all do this).
 * Only small extraction payloads ever touch the proxy; video bytes never do.
 *
 * Sign-in cookies (YTDLP_COOKIES) are attached for the request host so the
 * custom extractors can read authenticated pages (e.g. Instagram image posts).
 */

export const usingExtractorProxy = proxyConfigured;

type FetchInit = RequestInit & { dispatcher?: ProxyAgent };

/** Merge sign-in cookies for the target host into the request headers. */
function withCookies(
  input: string,
  init: RequestInit | undefined,
): RequestInit | undefined {
  const cookie = cookieHeaderFor(input);
  if (!cookie) return init;
  const headers = new Headers(init?.headers);
  if (!headers.has("Cookie")) headers.set("Cookie", cookie);
  return { ...init, headers };
}

function reFetchViaProxy(
  input: string,
  init: RequestInit | undefined,
): Promise<Response> | null {
  const dispatcher = proxyDispatcher();
  if (!dispatcher) return null;
  return fetch(input, { ...init, dispatcher } as FetchInit);
}

export async function extractorFetch(
  input: string,
  init: RequestInit | undefined,
  platform: PlatformId,
): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  init = withCookies(input, init);

  // Forced retry (a prior direct extraction failed) → use the proxy directly.
  // shouldUseProxy(platform, 0) is true only when forced (or not fallback-only).
  if (await shouldUseProxy(platform, 0)) {
    const p = reFetchViaProxy(input, init);
    if (p) {
      const r = await p;
      void recordRequest(true);
      if (method !== "HEAD") {
        const b = await r.text();
        void recordProxyBytes(platform, b.length);
        return new Response(b, { status: r.status, headers: r.headers });
      }
      return r;
    }
  }

  // HEAD (e.g. short-link resolution): no body to inspect, and callers rely on
  // res.url — so use status-only detection and never rebuild the Response.
  if (method === "HEAD") {
    let res: Response;
    try {
      res = await fetch(input, init);
    } catch (err) {
      if (await shouldUseProxy(platform, 1)) {
        const p = reFetchViaProxy(input, init);
        if (p) {
          void recordRequest(true);
          return p;
        }
      }
      throw err;
    }
    if (isBlockedStatus(res.status) && (await shouldUseProxy(platform, 1))) {
      const p = reFetchViaProxy(input, init);
      if (p) {
        void recordRequest(true);
        return p;
      }
    }
    // 🔴 Fire-and-forget (2026-08-16: "TikTok still takes time to fetch").
    // This was `await`ed, so every single extraction request — including
    // TikTok's short-link HEAD resolve below — paid a full Upstash Redis
    // round-trip AFTER the real network response came back, purely to bump a
    // usage counter nothing in the response depends on. `incr()` already
    // swallows its own errors (see proxy-manager.ts), so there is nothing to
    // await for correctness — only latency to lose by doing so.
    void recordRequest(false);
    return res;
  }

  // GET: read the body so we can detect 200-status login/challenge walls.
  let body: string;
  let status: number;
  let headers: Headers;
  try {
    const res = await fetch(input, init);
    status = res.status;
    headers = res.headers;
    body = await res.text();
  } catch (err) {
    if (await shouldUseProxy(platform, 1)) {
      const p = reFetchViaProxy(input, init);
      if (p) {
        const r = await p;
        const b = await r.text();
        void recordRequest(true);
        void recordProxyBytes(platform, b.length);
        return new Response(b, { status: r.status, headers: r.headers });
      }
    }
    throw err;
  }

  const blocked = isBlockedStatus(status) || looksLikeChallenge(body);

  if (blocked && (await shouldUseProxy(platform, 1))) {
    const p = reFetchViaProxy(input, init);
    if (p) {
      try {
        const r = await p;
        const b = await r.text();
        void recordRequest(true);
        void recordProxyBytes(platform, b.length);
        return new Response(b, { status: r.status, headers: r.headers });
      } catch {
        // Proxy attempt failed — fall through to the original direct response.
      }
    }
  }

  // Same fire-and-forget fix as the HEAD branch above — this is the line every
  // TikWM lookup (the fast path for every TikTok fetch) was paying for.
  void recordRequest(false);
  return new Response(body, { status, headers });
}
