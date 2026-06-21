import { ProxyAgent } from "undici";

import {
  isBlockedStatus,
  proxyConfigured,
  proxyDispatcher,
  recordProxyBytes,
  recordRequest,
  shouldUseProxy,
} from "@/server/proxy/proxy-manager";
import type { PlatformId } from "@/types";

/**
 * Smart extractor fetch: tries a DIRECT request first (cheap VPS bandwidth) and
 * only retries through the residential proxy when the platform blocks us
 * (403/429/etc) AND the platform is proxy-eligible AND we're under budget.
 *
 * Only small extraction payloads (pages / API JSON) ever go through the proxy —
 * never video bytes — so proxy bandwidth stays minimal.
 */

export const usingExtractorProxy = proxyConfigured;

type FetchInit = RequestInit & { dispatcher?: ProxyAgent };

async function viaProxy(
  input: string,
  init: RequestInit | undefined,
  platform: PlatformId,
): Promise<Response> {
  const dispatcher = proxyDispatcher();
  if (!dispatcher) return fetch(input, init);
  const res = await fetch(input, { ...init, dispatcher } as FetchInit);
  await recordRequest(true);
  // Attribute extraction bandwidth (best-effort, from Content-Length).
  const len = Number(res.headers.get("content-length")) || 0;
  if (len > 0) await recordProxyBytes(platform, len);
  return res;
}

export async function extractorFetch(
  input: string,
  init: RequestInit | undefined,
  platform: PlatformId,
): Promise<Response> {
  // Attempt 0 — direct.
  let direct: Response;
  try {
    direct = await fetch(input, init);
  } catch (err) {
    // Direct connection failed entirely — retry via proxy if allowed.
    if (await shouldUseProxy(platform, 1)) {
      return viaProxy(input, init, platform);
    }
    throw err;
  }

  if (!isBlockedStatus(direct.status)) {
    await recordRequest(false);
    return direct;
  }

  // Direct was blocked — fall back to the residential proxy when permitted.
  if (await shouldUseProxy(platform, 1)) {
    try {
      return await viaProxy(input, init, platform);
    } catch {
      // Proxy attempt failed — surface the original blocked response.
    }
  }

  await recordRequest(false);
  return direct;
}
