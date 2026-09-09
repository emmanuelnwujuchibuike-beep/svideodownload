import { parseVideoUrl } from "@/lib/ai/clean-media";
import { detectPlatform } from "@/lib/platforms";
import type { PlatformId } from "@/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI PART 6 — deciding whether a pasted link may be fetched AT ALL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 1 shipped the link field with the owner's instruction written across it:
 * "Do not implement URL downloading yet. Do not fetch arbitrary URLs from the
 * browser." The browser half is still true and always will be. This module is
 * the server half finally arriving, and it exists because the moment a server
 * fetches an address a visitor chose, that visitor has been handed a request
 * from INSIDE our network.
 *
 * ── 🔴 THE DEFENCE IS AN ALLOW-LIST, NOT A DENY-LIST ────────────────────────
 *
 * Every SSRF filter written as "reject 127.0.0.1, reject 10.x, reject
 * 169.254.169.254" is eventually beaten, and the ways are well known: a
 * hostname that resolves to a private address, a DNS record that answers
 * differently on the second lookup than it did on the check (rebinding), a
 * redirect to a private address after a public first hop, an IPv4-mapped IPv6
 * literal, decimal or octal address spellings, an obscure scheme.
 *
 * None of those matter here, because the question this module asks is not "is
 * this address dangerous?" It is "is this host one of the dozen platforms
 * FrenzSave supports?" `tiktok.com` and `instagram.com` are not
 * attacker-controlled names, so what they resolve to is not an attacker's
 * choice — and everything else, including every address literal and every
 * spelling of one, fails for the same single reason.
 *
 * The checks below the allow-list are therefore belt-and-braces, kept because
 * they are cheap and because they make the refusal specific enough to say
 * something useful to somebody who pasted the wrong thing.
 *
 * ── Pure, and shared by three callers ───────────────────────────────────────
 *
 * The create route uses it to refuse a link before a row exists, the worker
 * uses it AGAIN before it fetches anything (a row could have been written by an
 * older build, or the allow-list could have narrowed since), and the tests use
 * it directly. No network, no DNS, no clock.
 */

/** Why a link was refused. Each maps to one sentence, in AI_SOURCE_URL_ERRORS. */
export type AiSourceUrlRefusal =
  | "malformed"
  | "insecure"
  | "credentials"
  | "port"
  | "address-literal"
  | "unsupported-host";

export type AiSourceUrlVerdict =
  | { ok: true; url: string; platform: PlatformId }
  | { ok: false; reason: AiSourceUrlRefusal };

/**
 * One sentence per refusal, written for the person who pasted the link.
 *
 * 🔴 Deliberately vague about the INTERNAL refusals. "That address isn't
 * allowed" is all somebody probing for an SSRF hole learns from
 * `address-literal`, whereas naming the rule tells them exactly which shape to
 * try next. The refusals a normal person can actually hit — a typo, a
 * platform we do not support — are specific, because those are the ones worth
 * explaining.
 */
export const AI_SOURCE_URL_ERRORS: Record<AiSourceUrlRefusal, string> = {
  malformed: "That doesn't look like a video link. Check it and paste it again.",
  insecure: "That link isn't secure. Paste the https:// version of it.",
  credentials: "That address isn't allowed.",
  port: "That address isn't allowed.",
  "address-literal": "That address isn't allowed.",
  "unsupported-host": "We can't fetch videos from that site yet. Choose a video from your device instead.",
};

/**
 * 🔴 The one platform recognised by `detectPlatform` that is NOT acceptable
 * here.
 *
 * `generic` means "the host matched nothing, and yt-dlp may or may not handle
 * it" — which for the downloader is a reasonable gamble on the visitor's own
 * behalf and here would be the entire hole this module exists to close. A
 * `generic` verdict is any host on the internet, so accepting it would make
 * the allow-list above no allow-list at all.
 *
 * `youtube` is deliberately still IN: it is a supported-but-unpromoted platform
 * (see SHOWCASE_PLATFORMS), and excluding it here would refuse a link the
 * downloader accepts, for a reason that has nothing to do with this feature.
 */
const REFUSED_PLATFORMS: readonly PlatformId[] = ["generic"];

/** IPv4 in any notation the URL parser will normalise, plus bracketed IPv6. */
function isAddressLiteral(hostname: string): boolean {
  // `new URL()` canonicalises 0x7f.1, 2130706433 and 127.1 to dotted-quad, so
  // by the time a hostname reaches here every IPv4 spelling looks the same.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // The parser strips the brackets from `[::1]` into the hostname itself.
  if (hostname.includes(":")) return true;
  if (hostname.startsWith("[") || hostname.endsWith("]")) return true;
  return false;
}

/**
 * The whole gate. Returns the NORMALISED url — never the raw input — so a
 * caller cannot accidentally store or fetch the string somebody typed.
 */
export function validateAiSourceUrl(raw: string): AiSourceUrlVerdict {
  /*
    Shape first, through the SAME parser the link field uses. Sharing it means
    the browser and the server cannot disagree about what a link is — including
    the `/clip.mp4` → `https://clip.mp4/` trap that parser already knows about,
    where the URL parser invents a host out of a filename.
  */
  const normalised = parseVideoUrl(raw);
  if (!normalised) return { ok: false, reason: "malformed" };

  let url: URL;
  try {
    url = new URL(normalised);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  /*
    🔴 HTTPS ONLY, which is stricter than `parseVideoUrl` (it allows http,
    because a person typing a link into a field is not making a security
    decision). Here the server is about to make the request, and a plaintext
    fetch initiated from our own network is both interceptable and the shape
    most internal services still speak.
  */
  if (url.protocol !== "https:") return { ok: false, reason: "insecure" };

  // `https://user:pass@host/` — never a video link, frequently an attempt to
  // confuse a parser about which part is the host.
  if (url.username || url.password) return { ok: false, reason: "credentials" };

  // No supported platform is served on a non-default port. A port is either a
  // typo or somebody reaching for a service that is not a website.
  if (url.port) return { ok: false, reason: "port" };

  if (isAddressLiteral(url.hostname)) return { ok: false, reason: "address-literal" };

  /*
    ── THE ALLOW-LIST ──────────────────────────────────────────────────────

    `detectPlatform` matches the host against the same registry the downloader
    uses, so this feature can never accept a source the rest of the product
    cannot fetch, and it gains a platform the day the product does. Anything
    unrecognised comes back as `generic`, which is refused.
  */
  const platform = detectPlatform(url.toString());
  if (REFUSED_PLATFORMS.includes(platform.id)) return { ok: false, reason: "unsupported-host" };

  return { ok: true, url: url.toString(), platform: platform.id };
}
