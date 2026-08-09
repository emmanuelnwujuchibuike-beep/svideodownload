import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A batch costs ONE download, and a limit says so in words.
 *
 * ── What the owner hit (2026-08-09) ──────────────────────────────────────────
 * "this tiktok multiple download failed some in the multiple download, and
 * shows error 429 … multiple download should be recorded as one in the free
 * user daily limit for download but not the rest api request."
 *
 * The link was a TikTok PHOTO SLIDESHOW — one post, twelve files. Each file
 * made its own `/api/download` call, and the daily cap was charged per CALL, so
 * the slideshow spent twelve of a free visitor's thirty. When the cap ran out
 * partway the remaining files came back 429 while the earlier ones had already
 * saved — hence "some failed".
 *
 * Two separate defects, and both had to be fixed:
 *   1. the QUOTA counted files instead of the thing the member asked for;
 *   2. the CLIENT threw the server's explanation away and showed "HTTP 429".
 *
 * These assertions live at the source level because the behaviour spans a
 * client module, an API route and a Redis-backed counter — there is no single
 * unit that can be called to observe it, and a test that mocked all three would
 * be asserting the mocks.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("a batch is charged once", () => {
  const quota = read("lib/api/download-quota.ts");
  const route = read("app/api/download/route.ts");
  const manager = read("features/downloads/manager.ts");
  const preview = read("features/downloader/preview-card.tsx");

  it("prefers the batch receipt over the per-download one", () => {
    // Most-inclusive unit of work wins: a batch covers all its files, a
    // download covers all its retries.
    expect(quota).toMatch(/batchId \? `\$\{key\}:b:\$\{batchId\}` : downloadId/);
  });

  it("writes the receipt only on a successful charge", () => {
    /*
      The safety property. If a refused attempt wrote a receipt, a batch that
      was denied could smuggle its siblings through on an id that never paid.
      `consumeDaily` owns this; the call must pass the receipt through it rather
      than marking anything itself.
    */
    expect(quota).toMatch(/consumeDaily\(key, limit, receipt\)/);
    expect(quota).not.toMatch(/markCounted|writeReceipt/);
  });

  it("carries the batch id from the picker to the request", () => {
    // One id minted per batch…
    expect(preview).toMatch(/const batchId = crypto\.randomUUID\(\)/);
    expect(preview).toMatch(/batchId,/);
    // …threaded onto every task, and onto the URL as `b`.
    expect(manager).toMatch(/if \(t\.batchId\) sp\.set\("b", t\.batchId\)/);
  });

  it("sanitises the batch id before it reaches a Redis key", () => {
    // Untrusted input. Same treatment as `t`, and the key is already scoped to
    // the caller's own user id or IP so a forged value can only hit themselves.
    expect(route).toMatch(/sp\.get\("b"\).*replace\(\/\[\^a-zA-Z0-9_-\]\/g, ""\)\.slice\(0, 64\)/s);
  });

  it("does NOT reduce the number of API requests", () => {
    /*
      The owner was explicit that only the QUOTA collapses — "not the rest api
      request". Each file still needs its own extraction and transfer, so the
      batch loop must still enqueue one download per item.
    */
    expect(preview).toMatch(/items\.forEach\(/);
  });
});

describe("a limit is explained, not thrown", () => {
  const manager = read("features/downloads/manager.ts");
  const route = read("app/api/download/route.ts");

  it("reads the server's message instead of the status code", () => {
    // The server was already writing the right sentence; the client discarded
    // the body and reported the status.
    expect(manager).toMatch(/async function failureMessage/);
    expect(manager).toMatch(/throw new Error\(await failureMessage\(res\)\)/);
    expect(manager).toMatch(/res\.clone\(\)\.json\(\)/);
  });

  it("names the limit in plain words even with no body", () => {
    expect(manager).toMatch(/res\.status === 429/);
    expect(manager).toMatch(/Daily download limit reached/i);
  });

  it("the server still sends a real explanation", () => {
    expect(route).toMatch(/Daily download limit reached \(\$\{quota\.limit\}\/day\)/);
    expect(route).toMatch(/RATE_LIMITED/);
  });

  it("never auto-retries a limit — it is not transient", () => {
    // Retrying a 429 spends more units and deepens the lockout. Pinned in the
    // retry policy, which is where the runaway happened before.
    const policy = read("features/downloads/retry-policy.ts");
    expect(policy).toMatch(/429/);
  });
});
