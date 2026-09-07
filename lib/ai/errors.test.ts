import { describe, expect, it } from "vitest";

import {
  AI_ERRORS,
  AiJobError,
  aiErrorBody,
  aiErrorStatus,
  isAiJobError,
  storedErrorMessage,
  type AiErrorCode,
} from "./errors";

const CODES = Object.keys(AI_ERRORS) as AiErrorCode[];

describe("the error table", () => {
  it("gives every code a real sentence and a sane status", () => {
    for (const code of CODES) {
      const spec = AI_ERRORS[code];
      expect(spec.message.length, `${code} has no message`).toBeGreaterThan(10);
      expect(spec.status, `${code} has an odd status`).toBeGreaterThanOrEqual(400);
      expect(spec.status).toBeLessThan(600);
    }
  });

  it("🔴 never says anything a member cannot act on", () => {
    // The messages are the whole reason the codes exist separately. If a code
    // leaks into the copy, the split has failed and somebody is reading
    // "PROVIDER_ERROR" on a screen.
    for (const code of CODES) {
      expect(AI_ERRORS[code].message).not.toContain(code);
      expect(AI_ERRORS[code].message).not.toMatch(/replicate|webhook|postgres|supabase|token/i);
    }
  });

  it("answers a refused limit with 429 and a missing job with 404", () => {
    expect(aiErrorStatus("DAILY_LIMIT_REACHED")).toBe(429);
    expect(aiErrorStatus("RATE_LIMITED")).toBe(429);
    expect(aiErrorStatus("JOB_NOT_FOUND")).toBe(404);
    expect(aiErrorStatus("AUTH_REQUIRED")).toBe(401);
    // 503, not 403: the member is not forbidden, the tool is not running.
    expect(aiErrorStatus("FEATURE_UNAVAILABLE")).toBe(503);
  });
});

describe("aiErrorBody", () => {
  it("always carries both halves — the stable code and the readable sentence", () => {
    expect(aiErrorBody("JOB_NOT_FOUND")).toEqual({
      code: "JOB_NOT_FOUND",
      error: AI_ERRORS.JOB_NOT_FOUND.message,
    });
  });

  it("carries the small safe facts a specific refusal needs", () => {
    const body = aiErrorBody("DAILY_LIMIT_REACHED", { usage: { limit: 3, used: 3 } });
    expect(body.code).toBe("DAILY_LIMIT_REACHED");
    expect(body.usage).toEqual({ limit: 3, used: 3 });
  });

  it("lets a caller replace the sentence with a more specific one", () => {
    // The feature registry knows the real reason a tool is off; the table only
    // has a generic one. The specific answer wins.
    const body = aiErrorBody("FEATURE_UNAVAILABLE", { error: "The AI service isn't connected yet." });
    expect(body.error).toBe("The AI service isn't connected yet.");
    expect(body.code).toBe("FEATURE_UNAVAILABLE");
  });
});

describe("storedErrorMessage", () => {
  it("resolves a code this build knows", () => {
    expect(storedErrorMessage("PROVIDER_ERROR")).toBe(AI_ERRORS.PROVIDER_ERROR.message);
  });

  it("degrades rather than leaking a raw token from an older row", () => {
    const out = storedErrorMessage("SOME_CODE_FROM_2027");
    expect(out).not.toContain("SOME_CODE_FROM_2027");
    expect(out.length).toBeGreaterThan(10);
  });
});

describe("AiJobError", () => {
  it("carries its code and keeps operator detail off the member's message", () => {
    const err = new AiJobError("STORAGE_ERROR", "bucket frenz-ai-source returned 403 for key x/y/z");
    expect(err.code).toBe("STORAGE_ERROR");
    expect(err.message).toBe(AI_ERRORS.STORAGE_ERROR.message);
    expect(err.message).not.toContain("frenz-ai-source");
    expect(err.detail).toContain("frenz-ai-source");
  });

  it("is recognisable across the service layer", () => {
    expect(isAiJobError(new AiJobError("JOB_NOT_FOUND"))).toBe(true);
    expect(isAiJobError(new Error("something else"))).toBe(false);
    expect(isAiJobError(null)).toBe(false);
  });
});
