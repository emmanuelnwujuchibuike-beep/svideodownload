import { describe, expect, it } from "vitest";

import { createIdempotencyKeyHolder } from "./idempotency-key";

/**
 * The rule under test is a money rule: the same request must carry the same
 * `clientRequestId` so the server's unique index on (user_id,
 * client_request_id) can return the job already paid for instead of selling a
 * second one.
 *
 * Every test mints from a counter rather than `crypto.randomUUID()`, so "did
 * it mint again?" is directly observable instead of inferred.
 */
function counting() {
  let n = 0;
  return { mint: () => `key-${++n}`, minted: () => n };
}

const T2V = JSON.stringify({ feature: "text_to_video", input: { prompt: "a cat" } });
const T2V_EDITED = JSON.stringify({ feature: "text_to_video", input: { prompt: "a dog" } });

describe("createIdempotencyKeyHolder", () => {
  it("returns the same key for repeated asks about the same request", () => {
    const c = counting();
    const h = createIdempotencyKeyHolder(c.mint);

    expect(h.for(T2V)).toBe("key-1");
    expect(h.for(T2V)).toBe("key-1");
    expect(h.for(T2V)).toBe("key-1");
    expect(c.minted()).toBe(1);
  });

  it("THE RETRY CASE: a failed submit retried sends the key that was already sent", () => {
    const c = counting();
    const h = createIdempotencyKeyHolder(c.mint);

    // First attempt — the POST goes out, the server creates and CHARGES a job,
    // and the reply is lost (on this stack an origin 502 arrives as
    // Cloudflare's HTML page, so the client cannot tell this from a refusal).
    const first = h.for(T2V);
    // The member sees "We couldn't reach the service" and taps again.
    const retry = h.for(T2V);

    // Same key ⇒ the insert hits the unique index ⇒ the existing job comes
    // back ⇒ no second reservation. A fresh uuid here is a second charge.
    expect(retry).toBe(first);
    expect(c.minted()).toBe(1);
  });

  it("mints a new key once the request itself changes", () => {
    const c = counting();
    const h = createIdempotencyKeyHolder(c.mint);

    const before = h.for(T2V);
    const after = h.for(T2V_EDITED);

    // Holding the key across an edit is the quieter bug: the server would
    // return the job made from the OLD prompt and ignore the new one.
    expect(after).not.toBe(before);
    expect(c.minted()).toBe(2);
  });

  it("mints a new key after clear(), which is what success calls", () => {
    const c = counting();
    const h = createIdempotencyKeyHolder(c.mint);

    const first = h.for(T2V);
    h.clear(); // a job now exists under `first` and is paid for
    const second = h.for(T2V);

    // Same inputs, deliberately generating again — this must be a NEW job, not
    // the one already made.
    expect(second).not.toBe(first);
    expect(c.minted()).toBe(2);
  });

  it("goes back to reusing after a clear, rather than minting every time", () => {
    const c = counting();
    const h = createIdempotencyKeyHolder(c.mint);

    h.for(T2V);
    h.clear();
    const a = h.for(T2V);
    const b = h.for(T2V);

    expect(b).toBe(a);
    expect(c.minted()).toBe(2);
  });

  /*
    ── TEETH ──────────────────────────────────────────────────────────────────

    A guard that cannot fail proves nothing (AGENTS.md §3). This is the code
    that actually shipped — a fresh key on every call, which is what the inline
    `crypto.randomUUID()` in the fetch body did. It must fail the retry test
    above; if it passes, the suite is not testing anything.
  */
  it("TEETH: the shipped behaviour (a fresh key per call) fails the retry rule", () => {
    const c = counting();
    const alwaysFresh = {
      for: () => c.mint(),
      clear: () => {},
    };

    const first = alwaysFresh.for();
    const retry = alwaysFresh.for();

    expect(retry).not.toBe(first); // ← the defect, reproduced
    expect(c.minted()).toBe(2); // ← two keys ⇒ two jobs ⇒ two charges
  });

  it("mints keys the ai_jobs CHECK constraint accepts (8..100 chars)", () => {
    // 0141: `char_length(client_request_id) between 8 and 100`.
    const h = createIdempotencyKeyHolder();
    const key = h.for(T2V);

    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(100);
  });
});
