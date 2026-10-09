import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { checkDestinationUrl } from "./creative-validation";

/**
 * Part 8 — destination safety beyond syntax, on top of Part 2's checks
 * (`checkDestinationUrl` + the admin blocklist in server.ts).
 *
 *   heuristics  pure, no network:
 *               - an embedded URL in a redirect parameter, or a known open
 *                 redirector → BLOCK
 *               - a file-extension TLD (.zip, .mov) → BLOCK
 *               - an internationalized (xn--) host, or a well-known brand's
 *                 name inside someone else's domain → REVIEW (a person looks;
 *                 lookalikes are how phishing hides)
 *   reputation  Google Safe Browsing v4 when GOOGLE_SAFE_BROWSING_API_KEY is
 *               set. It sends the URL to Google, never fetches the page.
 *               A match → BLOCK.
 *   redirects   a RESTRICTED probe of where the link actually goes: HEAD
 *               only, https and port 443, at most 5 hops in 4 s, no body
 *               read. Every DNS answer is checked and private, loopback,
 *               link-local, CGNAT and metadata addresses are refused, and the
 *               connection is made to the checked address (no rebinding).
 *               Each hop passes the same syntax, heuristics and blocklist
 *               checks.
 *
 * SAFE-FAILURE POLICY. A check that cannot run never makes a link "safe":
 *   - reputation configured but unreachable → REVIEW
 *   - the link cannot be reached → REVIEW
 *   - reputation NOT configured → skipped (a coverage gap recorded in
 *     docs/AD_PLATFORM.md, Part 8)
 * REVIEW holds a campaign in `validating` for an admin. It never reaches the
 * serving payload.
 */

export type Verdict = { verdict: "ok" } | { verdict: "review"; reason: string } | { verdict: "block"; reason: string };

/** Query keys that carry a destination - with a full URL inside, they are redirects. */
const REDIRECT_PARAMS = new Set(["url", "u", "q", "redirect", "redirect_uri", "redirect_url", "redirecturl", "next", "dest", "destination", "target", "to", "goto", "link", "out", "continue", "return", "returnurl", "r"]);

/** Hosts (and their path prefix) that bounce to any destination given to them. */
const OPEN_REDIRECTORS: readonly [host: RegExp, path: RegExp][] = [
  [/(^|\.)google\.[a-z.]+$/, /^\/(url|amp\/s)\b/],
  [/^(l|lm|m)\.facebook\.com$/, /^\/l\.php/],
  [/^l\.instagram\.com$/, /^\//],
  [/(^|\.)youtube\.com$/, /^\/redirect/],
  [/^out\.reddit\.com$/, /^\//],
  [/^href\.li$/, /^\//],
  [/^(www\.)?linkedin\.com$/, /^\/redir/],
  [/^away\.vk\.com$/, /^\//],
  [/^slack-redir\.net$/, /^\//],
];

/** Brands whose name in a STRANGER's domain is a classic phishing tell. Their own domains are listed. */
const BRANDS: readonly [name: string, own: RegExp][] = [
  ["frenzsave", /(^|\.)frenzsave\.com$/],
  ["paypal", /(^|\.)paypal\.com$/],
  ["apple", /(^|\.)(apple|icloud)\.com$/],
  ["google", /(^|\.)google\.[a-z.]+$|(^|\.)(gmail|youtube)\.com$/],
  ["facebook", /(^|\.)(facebook|fb)\.com$/],
  ["instagram", /(^|\.)instagram\.com$/],
  ["whatsapp", /(^|\.)whatsapp\.(com|net)$/],
  ["microsoft", /(^|\.)(microsoft|live|outlook|office)\.com$/],
  ["amazon", /(^|\.)amazon\.[a-z.]+$/],
  ["netflix", /(^|\.)netflix\.com$/],
  ["binance", /(^|\.)binance\.com$/],
  ["coinbase", /(^|\.)coinbase\.com$/],
  ["metamask", /(^|\.)metamask\.io$/],
  ["opay", /(^|\.)opayweb\.com$|(^|\.)opay\.(ng|com)$/],
  ["paystack", /(^|\.)paystack\.(com|co)$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
];

const FILE_TLDS = new Set(["zip", "mov"]);

function hasEmbeddedUrl(v: string): boolean {
  let s = v;
  for (let i = 0; i < 3; i++) {
    try {
      const d = decodeURIComponent(s);
      if (d === s) break;
      s = d;
    } catch {
      break;
    }
  }
  return /(^|[^a-z])(https?:)?\/\/[a-z0-9-]+\.[a-z]/i.test(s) || /^https?:/i.test(s);
}

/** The pure checks. `raw` must already pass `checkDestinationUrl`. */
export function destinationHeuristics(raw: string): Verdict {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { verdict: "block", reason: "url_invalid" };
  }
  const host = u.hostname.toLowerCase();
  const tld = host.split(".").pop() ?? "";
  if (FILE_TLDS.has(tld)) return { verdict: "block", reason: "file_extension_domain" };
  for (const [h, p] of OPEN_REDIRECTORS) if (h.test(host) && p.test(u.pathname)) return { verdict: "block", reason: "open_redirector" };
  for (const [k, v] of u.searchParams) {
    if (REDIRECT_PARAMS.has(k.toLowerCase()) && hasEmbeddedUrl(v)) return { verdict: "block", reason: "redirect_parameter" };
  }
  if (hasEmbeddedUrl(u.pathname.replace(/^\/+/, ""))) return { verdict: "block", reason: "embedded_url" };
  if (host.split(".").some((l) => l.startsWith("xn--"))) return { verdict: "review", reason: "internationalized_domain" };
  // label tokens, with the usual look-alike digits read as letters (paypa1 → paypal)
  const tokens = host.split(/[.-]/).map((t) => t.replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e").replace(/5/g, "s").replace(/4/g, "a"));
  for (const [name, own] of BRANDS) {
    if (own.test(host)) continue;
    const hit = tokens.some((t) => t === name || (name.length >= 6 && t.includes(name)));
    if (hit) return { verdict: "review", reason: `brand_lookalike:${name}` };
  }
  return { verdict: "ok" };
}

/* ─────────────────────────────── reputation ─────────────────────────────── */

const SAFE_BROWSING_KEY = () => process.env.GOOGLE_SAFE_BROWSING_API_KEY?.trim() || null;

/** null = not configured. "unavailable" = configured but the lookup failed. */
export async function reputationLookup(url: string, fetchImpl: typeof fetch = fetch): Promise<Verdict | "unavailable" | null> {
  const key = SAFE_BROWSING_KEY();
  if (!key) return null;
  try {
    const res = await fetchImpl(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "frenzsave-ads", clientVersion: "1" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url }],
        },
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return "unavailable";
    const data = (await res.json()) as { matches?: { threatType?: string }[] };
    const hit = data.matches?.[0];
    return hit ? { verdict: "block", reason: `reputation:${(hit.threatType ?? "unsafe").toLowerCase()}` } : { verdict: "ok" };
  } catch {
    return "unavailable";
  }
}

/* ─────────────────────────────── restricted redirect probe ─────────────────────────────── */

/** Addresses a probe may never connect to. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8");
  }
  return true;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** A DNS lookup that refuses any private answer - handed to the socket, so it connects to what was checked. */
function safeLookup(hostname: string, options: { all?: boolean } | number | undefined, cb: LookupCb): void {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err, "", 4);
    const list = (addrs as LookupAddress[]) ?? [];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      const e = new Error("private_address") as NodeJS.ErrnoException;
      e.code = "EPRIVATE";
      return cb(e, "", 4);
    }
    if (typeof options === "object" && options?.all) return cb(null, list);
    cb(null, list[0]!.address, list[0]!.family);
  });
}

function headOnce(url: URL, timeoutMs: number): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "HEAD",
        lookup: safeLookup as never,
        timeout: timeoutMs,
        headers: { "user-agent": "FrenzsaveAdsLinkCheck/1.0 (+https://frenzsave.com/advertise/rules)", accept: "*/*" },
      },
      (res) => {
        const loc = res.headers.location ?? null;
        res.destroy();
        resolve({ status: res.statusCode ?? 0, location: typeof loc === "string" ? loc : null });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export interface ChaseResult {
  /** the URL the chain ended on */
  final: string;
  hops: number;
  verdict: Verdict;
}

/**
 * Follow the link's redirects, checking every hop. `extraCheck` is the admin
 * blocklist (a database read), run on every hop's host.
 */
export async function chaseRedirects(raw: string, extraCheck: (host: string) => Promise<string | null>, opts: { maxHops?: number; budgetMs?: number } = {}): Promise<ChaseResult> {
  const maxHops = opts.maxHops ?? 5;
  const deadline = Date.now() + (opts.budgetMs ?? 4000);
  let current = new URL(raw.trim());
  for (let hop = 0; hop <= maxHops; hop++) {
    const left = deadline - Date.now();
    if (left <= 0) return { final: current.href, hops: hop, verdict: { verdict: "review", reason: "unreachable" } };
    let res: { status: number; location: string | null };
    try {
      res = await headOnce(current, Math.min(left, 3000));
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      return { final: current.href, hops: hop, verdict: code === "EPRIVATE" ? { verdict: "block", reason: "private_address" } : { verdict: "review", reason: "unreachable" } };
    }
    if (res.status < 300 || res.status >= 400 || !res.location) return { final: current.href, hops: hop, verdict: { verdict: "ok" } };
    let next: URL;
    try {
      next = new URL(res.location, current);
    } catch {
      return { final: current.href, hops: hop, verdict: { verdict: "block", reason: "bad_redirect" } };
    }
    if (checkDestinationUrl(next.href).status !== "valid") return { final: next.href, hops: hop + 1, verdict: { verdict: "block", reason: "redirect_to_unsafe_url" } };
    const h = destinationHeuristics(next.href);
    if (h.verdict === "block") return { final: next.href, hops: hop + 1, verdict: { verdict: "block", reason: `redirect_${h.reason}` } };
    const blocked = await extraCheck(next.hostname.toLowerCase());
    if (blocked) return { final: next.href, hops: hop + 1, verdict: { verdict: "block", reason: `redirect_to_blocked:${blocked}` } };
    current = next;
  }
  return { final: current.href, hops: maxHops, verdict: { verdict: "review", reason: "redirect_chain_too_long" } };
}

/** Registrable-ish domain: the last two labels (three for a short second-level like co.uk). */
export function baseDomain(host: string): string {
  const parts = host.toLowerCase().split(".");
  const two = parts.slice(-2).join(".");
  return parts.length > 2 && /^(co|com|org|net|gov|edu|ac)\.[a-z]{2}$/.test(two) ? parts.slice(-3).join(".") : two;
}
