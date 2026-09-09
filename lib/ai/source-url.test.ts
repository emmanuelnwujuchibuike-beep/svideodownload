import { describe, expect, it } from "vitest";

import { AI_SOURCE_URL_ERRORS, validateAiSourceUrl } from "@/lib/ai/source-url";

/**
 * The SSRF surface, tested as a list of the things people actually try.
 *
 * Every case below is refused by the ALLOW-LIST alone — none of them is a
 * supported platform — which is the property worth asserting: the specific
 * rules are a second line, and if one of them were deleted tomorrow not one of
 * these would start passing.
 */
describe("validateAiSourceUrl — the addresses a server must never be pointed at", () => {
  const hostile = [
    // Cloud instance metadata. The single most valuable SSRF target there is:
    // on a misconfigured host it hands back credentials.
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "https://169.254.169.254/",
    "http://metadata.google.internal/computeMetadata/v1/",
    // Loopback, in several spellings the URL parser normalises differently.
    "http://127.0.0.1:5432/",
    "https://127.1/",
    "https://0x7f.1/",
    "https://2130706433/",
    "http://[::1]/",
    "http://localhost/",
    "http://localhost:3000/api/internal/ai/finalize",
    // Private ranges.
    "https://10.0.0.1/",
    "https://192.168.1.1/",
    "https://172.16.0.1/",
    // IPv4-mapped IPv6.
    "https://[::ffff:127.0.0.1]/",
    // Internal names.
    "https://supabase.internal/",
    "https://db.local/",
    // A credentialed authority, the classic "which part is the host" confusion.
    "https://tiktok.com@evil.example/video",
    // Not a website at all.
    "file:///etc/passwd",
    "gopher://127.0.0.1:6379/_INFO",
    "redis://127.0.0.1:6379",
    // A supported platform's name as a SUBDOMAIN of somebody else's host.
    "https://tiktok.com.evil.example/v/1",
    // …and as a path.
    "https://evil.example/tiktok.com/v/1",
  ];

  for (const url of hostile) {
    it(`refuses ${url}`, () => {
      const verdict = validateAiSourceUrl(url);
      expect(verdict.ok).toBe(false);
    });
  }

  it("refuses a bare filename that the URL parser would invent a host from", () => {
    // `/clip.mp4` becomes `https://clip.mp4/` if you prefix it naively.
    expect(validateAiSourceUrl("/clip.mp4").ok).toBe(false);
    expect(validateAiSourceUrl("clip.mp4").ok).toBe(false);
  });

  it("refuses empty and whitespace input", () => {
    for (const value of ["", "   ", "\t", "https://tiktok.com/ /v"]) {
      expect(validateAiSourceUrl(value).ok).toBe(false);
    }
  });
});

describe("validateAiSourceUrl — what it accepts", () => {
  const accepted: [string, string][] = [
    ["https://www.tiktok.com/@someone/video/7123456789012345678", "tiktok"],
    ["https://vm.tiktok.com/ZMabcdef/", "tiktok"],
    ["https://www.instagram.com/reel/Cabcdefghij/", "instagram"],
    ["https://www.facebook.com/watch/?v=123456789", "facebook"],
    ["https://x.com/someone/status/123", "twitter"],
    ["https://www.pinterest.com/pin/123456789/", "pinterest"],
    ["https://vimeo.com/123456789", "vimeo"],
    // Supported but unpromoted — refusing it here would contradict the
    // downloader, for a reason that has nothing to do with this feature.
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
  ];

  for (const [url, platform] of accepted) {
    it(`accepts ${url} as ${platform}`, () => {
      const verdict = validateAiSourceUrl(url);
      expect(verdict.ok).toBe(true);
      if (verdict.ok) expect(verdict.platform).toBe(platform);
    });
  }

  it("returns the NORMALISED url, never the raw input", () => {
    const verdict = validateAiSourceUrl("  https://vm.tiktok.com/ZMabcdef  ");
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.url).toBe("https://vm.tiktok.com/ZMabcdef");
  });

  /*
    🔴 http is refused even for a host that WOULD be allowed. The link field
    tolerates it because a person typing is not making a security decision; by
    the time the server makes the request it is.
  */
  it("refuses http on a supported platform, and says which rule it broke", () => {
    const verdict = validateAiSourceUrl("http://www.tiktok.com/@a/video/1");
    expect(verdict).toEqual({ ok: false, reason: "insecure" });
  });

  it("refuses an explicit port on a supported platform", () => {
    expect(validateAiSourceUrl("https://www.tiktok.com:8443/@a/video/1")).toEqual({
      ok: false,
      reason: "port",
    });
  });
});

describe("the refusal copy", () => {
  it("has a sentence for every reason", () => {
    for (const [reason, sentence] of Object.entries(AI_SOURCE_URL_ERRORS)) {
      expect(sentence.length, reason).toBeGreaterThan(10);
    }
  });

  /*
    Somebody probing for an SSRF hole must not be told which rule they broke —
    naming it tells them exactly which shape to try next. The three internal
    refusals therefore share one deliberately uninformative sentence.
  */
  it("says the same uninformative thing for every internal-address refusal", () => {
    const opaque = AI_SOURCE_URL_ERRORS["address-literal"];
    expect(AI_SOURCE_URL_ERRORS.credentials).toBe(opaque);
    expect(AI_SOURCE_URL_ERRORS.port).toBe(opaque);
    expect(opaque).not.toMatch(/private|internal|loopback|localhost|metadata/i);
  });
});
