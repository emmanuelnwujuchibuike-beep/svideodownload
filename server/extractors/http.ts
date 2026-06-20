import { ProxyAgent } from "undici";

/**
 * Proxy-aware fetch for custom extractors.
 *
 * TikTok (and some other sites) serve a WAF / bot-challenge page to datacenter
 * IPs, so a plain server-side fetch returns no usable data. Setting
 * `EXTRACTOR_PROXY` (a residential/rotating HTTP proxy — the same mechanism
 * snaptik-style services rely on) routes extractor requests through it so the
 * fast custom path works in production. When unset, behaviour is identical to a
 * normal fetch.
 */

const PROXY_URL =
  process.env.EXTRACTOR_PROXY ||
  process.env.TIKTOK_PROXY ||
  process.env.HTTPS_PROXY ||
  "";

// One agent for the process; undici pools connections internally.
const proxyAgent = PROXY_URL ? new ProxyAgent(PROXY_URL) : null;

export const usingExtractorProxy = !!proxyAgent;

export function extractorFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  if (!proxyAgent) return fetch(input, init);
  // `dispatcher` is an undici extension not present in the DOM RequestInit type.
  return fetch(input, { ...init, dispatcher: proxyAgent } as RequestInit & {
    dispatcher: ProxyAgent;
  });
}
