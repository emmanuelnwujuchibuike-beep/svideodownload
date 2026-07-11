import { describe, expect, it } from "vitest";

import { isValidQueuedAction, shouldDropAfterStatus } from "./action-queue";

describe("shouldDropAfterStatus", () => {
  it("drops on 2xx (succeeded)", () => {
    expect(shouldDropAfterStatus(200)).toBe(true);
    expect(shouldDropAfterStatus(299)).toBe(true);
  });

  it("drops on 4xx (a client error that will never succeed on retry)", () => {
    expect(shouldDropAfterStatus(400)).toBe(true);
    expect(shouldDropAfterStatus(401)).toBe(true);
    expect(shouldDropAfterStatus(404)).toBe(true);
    expect(shouldDropAfterStatus(499)).toBe(true);
  });

  it("keeps queued on 5xx (retryable server error)", () => {
    expect(shouldDropAfterStatus(500)).toBe(false);
    expect(shouldDropAfterStatus(503)).toBe(false);
  });

  it("keeps queued on 1xx (not a real terminal case, but outside the drop range)", () => {
    expect(shouldDropAfterStatus(199)).toBe(false);
  });
});

describe("isValidQueuedAction", () => {
  it("accepts a well-formed queued action", () => {
    expect(isValidQueuedAction({ key: "like:1", url: "/api/posts/1/react", method: "POST", queuedAt: 123 })).toBe(
      true,
    );
  });

  it("accepts every supported method", () => {
    for (const method of ["POST", "DELETE", "PUT", "PATCH"]) {
      expect(isValidQueuedAction({ key: "k", url: "/api/x", method, queuedAt: 1 })).toBe(true);
    }
  });

  it("rejects a record with an unsupported method", () => {
    expect(isValidQueuedAction({ key: "k", url: "/api/x", method: "GET", queuedAt: 1 })).toBe(false);
  });

  it("rejects records missing required fields", () => {
    expect(isValidQueuedAction({ url: "/api/x", method: "POST", queuedAt: 1 })).toBe(false);
    expect(isValidQueuedAction({ key: "k", method: "POST", queuedAt: 1 })).toBe(false);
    expect(isValidQueuedAction({ key: "k", url: "/api/x", queuedAt: 1 })).toBe(false);
    expect(isValidQueuedAction({ key: "k", url: "/api/x", method: "POST" })).toBe(false);
  });

  it("rejects non-objects and empty strings", () => {
    expect(isValidQueuedAction(null)).toBe(false);
    expect(isValidQueuedAction(undefined)).toBe(false);
    expect(isValidQueuedAction("not an object")).toBe(false);
    expect(isValidQueuedAction({ key: "", url: "/api/x", method: "POST", queuedAt: 1 })).toBe(false);
  });
});
