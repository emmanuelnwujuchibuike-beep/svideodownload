import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cronAuthorized, hashCronToken, resetCronTokenCache } from "./auth";

/*
  ── Why this suite exists ──────────────────────────────────────────────────
  The owner spent a long time on a cron that returned 403 forever. The cause
  was not a wrong secret: `CRON_SECRET` was present in Vercel but set to the
  EMPTY STRING, so `secret &&` short-circuited and no header could ever match.
  A missing value and a wrong value produced the identical opaque response,
  which is why reading the code never found it.

  So the tests below pin the behaviours that make that class of failure
  impossible to repeat silently — above all `empty CRON_SECRET must not
  disable the other ways in`.
*/

const maybeSingle = vi.fn();
const fromSpy = vi.fn((_table: string) => ({
  select: () => ({ eq: () => ({ maybeSingle }) }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => fromSpy(table) }),
}));

const adminUser = vi.fn();
vi.mock("@/lib/admin/guard", () => ({
  getAdminUser: () => adminUser(),
}));

const TOKEN = "a".repeat(64);
const DIGEST = hashCronToken(TOKEN);

/** A stored row exactly as scripts/cron-token.mjs writes it. */
function storedToken(sha256: string = DIGEST) {
  maybeSingle.mockResolvedValue({
    data: { value: { sha256, updated_at: "2026-08-24T00:00:00.000Z" } },
    error: null,
  });
}

function req(authorization?: string): Request {
  return new Request("https://frenzsave.com/api/cron/streak-reminders", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  resetCronTokenCache();
  delete process.env.CRON_SECRET;
  adminUser.mockResolvedValue(null);
  maybeSingle.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe("hashCronToken", () => {
  it("is plain SHA-256, hex encoded", () => {
    // Known vector — pins the algorithm so scripts/cron-token.mjs (which
    // computes the digest independently, in .mjs) can never drift from it.
    expect(hashCronToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("cronAuthorized — CRON_SECRET env var (the original path)", () => {
  it("accepts the matching bearer", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    await expect(cronAuthorized(req("Bearer s3cret-value"))).resolves.toBe(true);
  });

  it("rejects a wrong bearer", async () => {
    process.env.CRON_SECRET = "s3cret-value";
    await expect(cronAuthorized(req("Bearer nope"))).resolves.toBe(false);
  });

  it("accepts a lowercase `bearer` scheme", async () => {
    // RFC 7235 says the scheme is case-insensitive; a curl typo should not
    // read as an authentication failure.
    process.env.CRON_SECRET = "s3cret-value";
    await expect(cronAuthorized(req("bearer s3cret-value"))).resolves.toBe(true);
  });

  it("never matches an env var that is present but EMPTY", async () => {
    // The production bug, pinned. "" must not authorise anything, including
    // an empty bearer.
    process.env.CRON_SECRET = "";
    await expect(cronAuthorized(req("Bearer "))).resolves.toBe(false);
    await expect(cronAuthorized(req("Bearer x"))).resolves.toBe(false);
  });
});

describe("cronAuthorized — database-backed token", () => {
  it("accepts the token whose digest is stored", async () => {
    storedToken();
    await expect(cronAuthorized(req(`Bearer ${TOKEN}`))).resolves.toBe(true);
    expect(fromSpy).toHaveBeenCalledWith("settings");
  });

  it("rejects a token that does not match the stored digest", async () => {
    storedToken();
    await expect(cronAuthorized(req(`Bearer ${"b".repeat(64)}`))).resolves.toBe(false);
  });

  it("works even when CRON_SECRET is present but empty", async () => {
    /*
     * 🔴 THE WHOLE POINT. The env var being "" is precisely the state the
     * owner's project was in; the database path has to survive it, otherwise
     * this refactor solves nothing.
     */
    process.env.CRON_SECRET = "";
    storedToken();
    await expect(cronAuthorized(req(`Bearer ${TOKEN}`))).resolves.toBe(true);
  });

  it("works when CRON_SECRET is set to something else entirely", async () => {
    // A stale env value must not shadow a freshly minted token.
    process.env.CRON_SECRET = "an-old-value-nobody-has";
    storedToken();
    await expect(cronAuthorized(req(`Bearer ${TOKEN}`))).resolves.toBe(true);
  });

  it("ignores a stored value that is not a 64-hex digest", async () => {
    // Defends against someone hand-editing the settings row and pasting the
    // token itself, which would otherwise become a plaintext credential.
    storedToken(TOKEN);
    await expect(cronAuthorized(req(`Bearer ${TOKEN}`))).resolves.toBe(false);
  });

  it("denies when the database read throws — fails closed", async () => {
    maybeSingle.mockRejectedValue(new Error("connection refused"));
    await expect(cronAuthorized(req(`Bearer ${TOKEN}`))).resolves.toBe(false);
  });

  it("denies when no token has been minted", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(cronAuthorized(req(`Bearer ${TOKEN}`))).resolves.toBe(false);
  });

  it("memoises the digest instead of reading per request", async () => {
    storedToken();
    await cronAuthorized(req(`Bearer ${TOKEN}`));
    await cronAuthorized(req(`Bearer ${TOKEN}`));
    await cronAuthorized(req(`Bearer ${TOKEN}`));
    expect(fromSpy).toHaveBeenCalledTimes(1);
  });
});

describe("cronAuthorized — the database read is guarded", () => {
  /*
    These routes are public and unauthenticated. If every request reached the
    database, anyone could drive load on it by spraying the URL, so noise must
    be rejected before the query.
  */
  it("does not query when there is no Authorization header", async () => {
    await expect(cronAuthorized(req())).resolves.toBe(false);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("does not query for a non-Bearer scheme", async () => {
    await expect(cronAuthorized(req("Basic dXNlcjpwYXNz"))).resolves.toBe(false);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("does not query for a bearer too short to be a token", async () => {
    await expect(cronAuthorized(req("Bearer short"))).resolves.toBe(false);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe("cronAuthorized — admin session", () => {
  it("authorises a signed-in admin with no bearer at all", async () => {
    adminUser.mockResolvedValue({ id: "338645d5", email: "admin@example.com" });
    await expect(cronAuthorized(req())).resolves.toBe(true);
  });

  it("does not authorise a non-admin visitor", async () => {
    adminUser.mockResolvedValue(null);
    await expect(cronAuthorized(req())).resolves.toBe(false);
  });
});

/*
  ── Source guards ─────────────────────────────────────────────────────────
  The minting script is plain .mjs and cannot import the TypeScript above, so
  these assert the two properties that cannot be checked by running it: that a
  raw token never reaches storage, and that every cron route goes through the
  shared check rather than re-implementing it.
*/
describe("scripts/cron-token.mjs", () => {
  const SRC = readFileSync("scripts/cron-token.mjs", "utf8");

  it("stores only the digest, never the token", () => {
    expect(SRC).toMatch(/sha256:\s*sha256\(token\)/);
    // The bare token must never be a stored field.
    expect(SRC).not.toMatch(/token:\s*token/);
  });

  it("never writes the token to a file", () => {
    expect(SRC).not.toMatch(/writeFileSync|appendFileSync|createWriteStream/);
  });
});

describe("every cron route delegates to the shared check", () => {
  const routes = [
    "abandoned-downloads",
    "daily-digest",
    "digest",
    "disappearing-messages",
    "friend-reminders",
    "profile-snapshots",
    "purge-deleted-accounts",
    "push-log-cleanup",
    "streak-reminders",
    "trending",
    "wallpaper-reminder",
  ];

  it.each(routes)("%s calls cronAuthorized", (name) => {
    const src = readFileSync(`app/api/cron/${name}/route.ts`, "utf8");
    expect(src).toContain("cronAuthorized(request)");
  });

  it.each(routes)("%s no longer compares CRON_SECRET itself", (name) => {
    const src = readFileSync(`app/api/cron/${name}/route.ts`, "utf8");
    // Comments may still mention it; code must not read it.
    expect(src).not.toContain("process.env.CRON_SECRET");
  });
});
