import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isRetryable, MAX_ATTEMPTS, RETRY_DELAY_MS } from "./retry-policy";

describe("isRetryable", () => {
  it("🔴 never retries a 429", () => {
    // The outage of 2026-08-09. /api/download spends a unit of the daily cap
    // per request; retrying a 429 spends three more per failure, so the limit
    // runs away and every download on the site fails until the UTC day rolls.
    expect(isRetryable("HTTP 429")).toBe(false);
    expect(isRetryable("Daily download limit reached (150/day). Sign up or upgrade for more.")).toBe(false);
    expect(isRetryable("Too many downloads. Please wait a moment.")).toBe(false);
    expect(isRetryable("Too many requests. Please slow down.")).toBe(false);
  });

  it("🔴 never retries a settled failure", () => {
    // These asserted true for weeks: the regex held literal backspace bytes
    // where its \b word boundaries belonged, so it matched nothing at all.
    expect(isRetryable("HTTP 404")).toBe(false);
    expect(isRetryable("HTTP 403")).toBe(false);
    expect(isRetryable("HTTP 401")).toBe(false);
    expect(isRetryable("HTTP 410")).toBe(false);
    expect(isRetryable("This post is private")).toBe(false);
    expect(isRetryable("The video was removed")).toBe(false);
    expect(isRetryable("Link expired")).toBe(false);
    expect(isRetryable("Not found")).toBe(false);
    expect(isRetryable("This video is unavailable in your country")).toBe(false);
  });

  it("retries the transient failures it exists for", () => {
    // 502 is almost the whole real error log — an upstream hiccup that
    // succeeds on the next attempt. Making someone tap Retry for it is
    // handing them our flakiness.
    expect(isRetryable("HTTP 502")).toBe(true);
    expect(isRetryable("HTTP 500")).toBe(true);
    expect(isRetryable("HTTP 503")).toBe(true);
    expect(isRetryable("Failed to fetch")).toBe(true);
    expect(isRetryable("network error")).toBe(true);
  });

  it("matches whole status codes, not fragments of longer numbers", () => {
    // Without word boundaries "4290" and "1404" would be read as 429 and 404 —
    // which is what makes the boundaries worth asserting rather than assuming.
    expect(isRetryable("HTTP 4290")).toBe(true);
    expect(isRetryable("byte 14042 of stream")).toBe(true);
  });

  it("has one backoff delay for every retry after the first", () => {
    expect(RETRY_DELAY_MS).toHaveLength(MAX_ATTEMPTS - 1);
  });
});

describe("the source itself", () => {
  it("🔴 contains no control-character corruption", () => {
    /*
     * A shell heredoc once replaced this module's `\b` escapes with literal
     * BACKSPACE bytes. The file still compiled, still linted, still type-checked
     * and still passed the build — the regex was valid, it simply could not
     * match anything. Nothing in the pipeline can see that, and it is invisible
     * in an editor.
     *
     * So the bytes get asserted directly. BEL, BACKSPACE, VT and FF have no
     * legitimate place in a TypeScript source file; if one appears here again,
     * this is the only thing that will say so.
     */
    const bytes = readFileSync(join(__dirname, "retry-policy.ts"));
    const offenders = [0x07, 0x08, 0x0b, 0x0c].filter((c) => bytes.includes(c));

    expect(
      offenders.map((c) => `0x0${c.toString(16)}`),
      "retry-policy.ts contains raw control bytes — a shell almost certainly ate " +
        "a backslash while writing it. The regexes will look correct and match nothing.",
    ).toEqual([]);
  });
});
