import { describe, expect, it } from "vitest";

import {
  RETRY_DELAY_MS,
  isBlockedOrUnavailable,
  shouldRetryVast,
  type ResolveOutcome,
} from "./vast-reliability";

/**
 * The rules that decide whether a failed ad request gets its ONE second ask.
 *
 * These matter more than they look: the failure modes here are the difference
 * between a zone that reports honestly and one that has read zero for weeks
 * while everything "worked".
 */

const at = (outcome: ResolveOutcome, spentMs: number, budgetMs = 3000, aborted = false) =>
  shouldRetryVast({ outcome, spentMs, budgetMs, aborted });

describe("shouldRetryVast — which failures earn a second ask", () => {
  it("🔴 retries a request that never got an answer", () => {
    // The case the whole layer exists for: blocked, unreachable, or a flapping
    // edge node. A blocked fetch rejects almost immediately, so the budget is
    // nearly untouched and the retry is both cheap and likely to work.
    expect(at("blocked_or_unavailable", 40).retry).toBe(true);
    expect(at("http_error", 120).retry).toBe(true);
    expect(at("malformed", 80).retry).toBe(true);
  });

  it("🔴🔴 NEVER retries an EMPTY response — that is a real answer", () => {
    /*
      The network said "I have no ad right now". Asking again turns one
      impression opportunity into two ad requests with no impression behind
      either, which is exactly what makes a publisher's fill rate look broken
      to the network — the opposite of what this layer is for.
    */
    const d = at("empty", 40);
    expect(d.retry).toBe(false);
    expect(d.reason).toBe("terminal");
  });

  it("🔴 NEVER retries after a cancellation, by either signal", () => {
    // Retrying past a cancellation is ignoring it — and the caller's budget or
    // an unmount is what cancelled.
    expect(at("aborted", 10).retry).toBe(false);
    expect(at("blocked_or_unavailable", 10, 3000, true).retry).toBe(false);
    expect(at("blocked_or_unavailable", 10, 3000, true).reason).toBe("aborted");
  });

  it("never retries a success", () => {
    expect(at("ok", 10).retry).toBe(false);
  });

  it("🔴 retries AT MOST once — the decision is per attempt, never a loop", () => {
    /*
      There is no counter here on purpose: the caller asks once, and a second
      failure is simply returned. A function that could answer "retry" twice
      would be an invitation to loop, which §5 forbids outright.
    */
    const first = at("blocked_or_unavailable", 40);
    expect(first.retry).toBe(true);
    // After the retry has spent its delay plus another attempt, the budget is
    // what stops a third — not a special case.
    expect(at("blocked_or_unavailable", 40 + RETRY_DELAY_MS + 2400).retry).toBe(false);
  });
});

describe("🔴 the budget check is what stops a slow network getting slower", () => {
  it("refuses the retry once the budget is spent", () => {
    const d = at("blocked_or_unavailable", 2900, 3000);
    expect(d.retry).toBe(false);
    expect(d.reason).toBe("no-budget");
  });

  it("🔴 a request that failed by TIMING OUT never doubles the wait", () => {
    /*
      This is the distinction that makes the layer safe without a separate
      "was it fast?" heuristic. A blocked request fails in milliseconds and
      leaves room; a timeout has already consumed the budget by definition, so
      the same arithmetic refuses it.
    */
    expect(at("blocked_or_unavailable", 40, 3000).retry).toBe(true);
    expect(at("blocked_or_unavailable", 3000, 3000).retry).toBe(false);
  });

  it("needs room for the PAUSE and the attempt, not just the pause", () => {
    // Exactly enough for the delay alone is not enough — there would be no time
    // left to actually ask again.
    expect(at("blocked_or_unavailable", 3000 - RETRY_DELAY_MS, 3000).retry).toBe(false);
    expect(at("blocked_or_unavailable", 3000 - RETRY_DELAY_MS - 1, 3000).retry).toBe(true);
  });

  it("respects a tiny admin budget without going negative", () => {
    expect(at("blocked_or_unavailable", 0, 500).retry).toBe(false);
  });
});

describe("isBlockedOrUnavailable — naming what is observable", () => {
  it("🔴 reports only the request never completing, and claims nothing more", () => {
    /*
      Deliberately not "ad blocker detected". A failed request is not proof of
      an extension, and a metric that overclaims is one nobody can act on —
      this project has a standing rule against fabricated stats.
    */
    expect(isBlockedOrUnavailable("blocked_or_unavailable")).toBe(true);
    for (const o of ["ok", "empty", "http_error", "malformed", "aborted"] as const) {
      expect(isBlockedOrUnavailable(o), o).toBe(false);
    }
  });

  it("🔴 keeps 'no fill' and 'could not ask' as different facts", () => {
    // A zone that reads empty for weeks is usually the second, and with both
    // collapsed into one signal there is no way to tell them apart.
    expect(isBlockedOrUnavailable("empty")).toBe(false);
  });
});
