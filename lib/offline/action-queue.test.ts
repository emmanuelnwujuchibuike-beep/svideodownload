import { describe, expect, it } from "vitest";

import { shouldDropAfterStatus } from "./action-queue";

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
