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

/**
 * Smart extractor fetch: DIRECT first (cheap), residential proxy only as a
 * fallback when the platform blocks us — by HTTP status (403/429) OR by serving
 * a 200 login/WAF/challenge page (Instagram, Facebook, TikTok all do this).
 * Only small extraction payloads ever touch the proxy; video bytes never do.
 */

export const usingExtractorProxy = proxyConfigured;

type FetchInit = RequestInit & { dispatcher?: ProxyAgent };

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

  // Forced retry (a prior direct extraction failed) → use the proxy directly.
  // shouldUseProxy(platform, 0) is true only when forced (or not fallback-only).
  if (await shouldUseProxy(platform, 0)) {
    const p = reFetchViaProxy(input, init);
    if (p) {
      const r = await p;
      await recordRequest(true);
      if (method !== "HEAD") {
        const b = await r.text();
        await recordProxyBytes(platform, b.length);
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
          await recordRequest(true);
          return p;
        }
      }
      throw err;
    }
    if (isBlockedStatus(res.status) && (await shouldUseProxy(platform, 1))) {
      const p = reFetchViaProxy(input, init);
      if (p) {
        await recordRequest(true);
        return p;
      }
    }
    await recordRequest(false);
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
        await recordRequest(true);
        await recordProxyBytes(platform, b.length);
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
        await recordRequest(true);
        await recordProxyBytes(platform, b.length);
        return new Response(b, { status: r.status, headers: r.headers });
      } catch {
        // Proxy attempt failed — fall through to the original direct response.
      }
    }
  }

  await recordRequest(false);
  return new Response(body, { status, headers });
}
