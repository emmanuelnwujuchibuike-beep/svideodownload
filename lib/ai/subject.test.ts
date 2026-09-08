import { beforeAll, describe, expect, it } from "vitest";

import {
  AI_GUEST_IP_DAILY_CEILING,
  guestSubject,
  ipCeilingKey,
  mintGuestToken,
  readGuestToken,
  subjectFromRow,
  subjectOwnerId,
  userSubject,
} from "./subject";

/**
 * The guest identifier is the only thing standing between an anonymous
 * allowance and an unbounded provider bill, so it gets a hostile test rather
 * than a happy-path one.
 */

beforeAll(() => {
  // A deterministic key, so signatures are stable within the run.
  process.env.AI_GUEST_SECRET = "test-secret-for-guest-identifiers";
});

describe("minting and verifying", () => {
  it("round-trips a token it issued", () => {
    const { id, token } = mintGuestToken();
    expect(readGuestToken(token)).toBe(id);
  });

  it("issues a different identifier every time", () => {
    const seen = new Set(Array.from({ length: 200 }, () => mintGuestToken().id));
    // 16 bytes of CSPRNG. A collision here means the generator is broken.
    expect(seen.size).toBe(200);
  });

  it("carries no information about the visitor", () => {
    // 22 base64url characters and nothing else — not derived from an address, a
    // user agent or anything about the person. That is what keeps it the
    // opposite of a fingerprint.
    expect(mintGuestToken().id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe("🔴 a browser cannot forge an identity", () => {
  it("rejects an unsigned id", () => {
    const { id } = mintGuestToken();
    expect(readGuestToken(id)).toBeNull();
  });

  it("rejects a tampered id with a valid-looking signature", () => {
    const { id, token } = mintGuestToken();
    const sig = token.slice(token.indexOf(".") + 1);
    // Change one character of the id, keep the signature.
    const other = (id[0] === "A" ? "B" : "A") + id.slice(1);
    expect(readGuestToken(`${other}.${sig}`)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const { id, token } = mintGuestToken();
    const sig = token.slice(token.indexOf(".") + 1);
    const broken = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(readGuestToken(`${id}.${broken}`)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const { token } = mintGuestToken();
    process.env.AI_GUEST_SECRET = "a-completely-different-secret";
    try {
      // 🔴 This is also the rotation story: changing the variable invalidates
      // every outstanding cookie at once and everyone is quietly reissued.
      expect(readGuestToken(token)).toBeNull();
    } finally {
      process.env.AI_GUEST_SECRET = "test-secret-for-guest-identifiers";
    }
  });

  it("rejects junk without hashing it", () => {
    for (const bad of [
      null,
      undefined,
      "",
      ".",
      "..",
      "no-dot-at-all",
      ".onlysignature",
      "onlyid.",
      "a".repeat(5000),
      // A shape that passes a naive split but not the length rules.
      "short.sig",
      /*
        🔴 ESCAPES, NEVER LITERALS. A right-to-left override or a NUL typed
        straight into source looks identical to a clean line in every editor and
        every diff — source-integrity.test.ts exists because exactly that
        happened in this repo once already.
      */
      `abc\u202Edef.${"x".repeat(24)}`,
      `abc\u0000def.${"x".repeat(24)}`,
      // Path traversal, in case an id ever reaches a storage key unescaped.
      `../../etc.${"x".repeat(24)}`,
    ]) {
      expect(readGuestToken(bad as string)).toBeNull();
    }
  });
});

describe("subjects", () => {
  it("keys a member and a guest into different namespaces", () => {
    const u = userSubject("11111111-1111-1111-1111-111111111111");
    const g = guestSubject("aaaaaaaaaaaaaaaaaaaaaa");
    expect(u.key.startsWith("u:")).toBe(true);
    expect(g.key.startsWith("g:")).toBe(true);
    // 🔴 A guest id must never be able to collide with a user id in any counter
    // or rate-limit bucket.
    expect(u.key).not.toBe(g.key);
  });

  it("keeps the storage prefix free of the key's namespace colon", () => {
    // Object keys are `<ownerId>/<feature>/<jobId>/…`; a colon in there would
    // be a small horror to debug later.
    expect(subjectOwnerId(guestSubject("aaaaaaaaaaaaaaaaaaaaaa"))).not.toContain(":");
    expect(subjectOwnerId(userSubject("u1"))).toBe("u1");
  });

  it("reads the owner off a stored row", () => {
    expect(subjectFromRow({ user_id: "u1", guest_id: null })?.kind).toBe("user");
    expect(subjectFromRow({ user_id: null, guest_id: "g1" })?.kind).toBe("guest");
    // Forbidden by `ai_jobs_subject_chk`, but a check constraint is the
    // database's promise and this is TypeScript's.
    expect(subjectFromRow({ user_id: null, guest_id: null })).toBeNull();
  });
});

describe("the address ceiling", () => {
  it("is stable for one address and different for another", () => {
    expect(ipCeilingKey("41.58.1.2")).toBe(ipCeilingKey("41.58.1.2"));
    expect(ipCeilingKey("41.58.1.2")).not.toBe(ipCeilingKey("41.58.1.3"));
  });

  it("🔴 never contains the address, and is salted so it cannot be reversed", () => {
    const ip = "41.58.1.2";
    const key = ipCeilingKey(ip);
    expect(key).not.toContain(ip);
    expect(key.startsWith("ip:")).toBe(true);

    // A plain SHA-256 of an IP is trivially reversible — the whole IPv4 space
    // is minutes of work. Changing the salt must change the key, which is what
    // proves a secret is actually mixed in.
    const before = ipCeilingKey(ip);
    process.env.AI_GUEST_SECRET = "another-salt-entirely";
    try {
      expect(ipCeilingKey(ip)).not.toBe(before);
    } finally {
      process.env.AI_GUEST_SECRET = "test-secret-for-guest-identifiers";
    }
  });

  it("fits the guest_id column's bounds so a ceiling row can be written", () => {
    const key = ipCeilingKey("41.58.1.2");
    // `ai_usage_daily_guest_id_chk` allows 8..64 characters.
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(64);
  });

  it("is set well above a single visitor's allowance", () => {
    // Six times 2/day. A household, an office or a café is never affected; a
    // script cycling cookies stops after six rounds.
    expect(AI_GUEST_IP_DAILY_CEILING).toBeGreaterThanOrEqual(12);
  });
});
