import { describe, expect, it } from "vitest";

import { readSessionExpiry, sessionIsComfortablyFresh } from "./session-cookie";

/**
 * These guard a format this repo does NOT own: @supabase/ssr's session cookie
 * encoding (`base64-` + base64url, chunked as `.0`/`.1`). Middleware skips its
 * auth round-trip based on what's read here, so a silent parse regression after
 * a dependency bump would put every request back on the slow path — or worse,
 * misread an expiry. The `null`/false fallbacks are the safety contract: unknown
 * must always mean "do the full check", never "assume fresh".
 */

const NAME = "sb-abcdefgh-auth-token";

/** Encodes a session exactly the way @supabase/ssr's storage adapter does. */
function encode(session: object): string {
  const json = JSON.stringify(session);
  const b64url = Buffer.from(json, "utf8").toString("base64url");
  return `base64-${b64url}`;
}

const inFuture = (secs: number) => Math.floor(Date.now() / 1000) + secs;

describe("readSessionExpiry", () => {
  it("reads expires_at from a base64url-encoded cookie", () => {
    const exp = inFuture(3600);
    expect(readSessionExpiry([{ name: NAME, value: encode({ expires_at: exp }) }])).toBe(exp);
  });

  it("reads a plain (unencoded) JSON cookie", () => {
    const exp = inFuture(600);
    expect(readSessionExpiry([{ name: NAME, value: JSON.stringify({ expires_at: exp }) }])).toBe(exp);
  });

  it("reassembles chunked cookies in numeric order, not lexicographic", () => {
    const exp = inFuture(1200);
    // A session big enough to chunk past `.9` — `.10` must follow `.9`.
    const encoded = encode({ expires_at: exp, padding: "x".repeat(4000) });
    const size = Math.ceil(encoded.length / 11);
    const chunks = Array.from({ length: 11 }, (_, i) => ({
      name: `${NAME}.${i}`,
      value: encoded.slice(i * size, (i + 1) * size),
    }));
    // Shuffled: real cookie order is never guaranteed.
    expect(readSessionExpiry([...chunks].reverse())).toBe(exp);
  });

  it("survives non-ASCII session data (accents/emoji in profile metadata)", () => {
    const exp = inFuture(900);
    const value = encode({ expires_at: exp, user: { name: "Zoë 🎧 Ünal" } });
    expect(readSessionExpiry([{ name: NAME, value }])).toBe(exp);
  });

  it("ignores the PKCE code-verifier cookie, which is not a session", () => {
    expect(readSessionExpiry([{ name: "sb-abcdefgh-auth-token-code-verifier", value: "abc123" }])).toBeNull();
  });

  it("returns null for no cookie, garbage, or a missing/non-numeric expires_at", () => {
    expect(readSessionExpiry([])).toBeNull();
    expect(readSessionExpiry([{ name: NAME, value: "base64-!!!not-valid!!!" }])).toBeNull();
    expect(readSessionExpiry([{ name: NAME, value: encode({ no_expiry: true }) }])).toBeNull();
    expect(readSessionExpiry([{ name: NAME, value: encode({ expires_at: "soon" }) }])).toBeNull();
  });
});

describe("sessionIsComfortablyFresh", () => {
  it("is true only well beyond auth-js's own 90s refresh margin", () => {
    // 1h out: nothing downstream will try to refresh.
    expect(sessionIsComfortablyFresh([{ name: NAME, value: encode({ expires_at: inFuture(3600) }) }])).toBe(true);
    // 60s out: inside auth-js's margin — a Server Component WOULD refresh here,
    // so middleware must not skip.
    expect(sessionIsComfortablyFresh([{ name: NAME, value: encode({ expires_at: inFuture(60) }) }])).toBe(false);
    // Already expired.
    expect(sessionIsComfortablyFresh([{ name: NAME, value: encode({ expires_at: inFuture(-10) }) }])).toBe(false);
  });

  it("fails safe (false) when the expiry can't be read", () => {
    expect(sessionIsComfortablyFresh([])).toBe(false);
    expect(sessionIsComfortablyFresh([{ name: NAME, value: "base64-garbage!!" }])).toBe(false);
  });
});
