import { describe, expect, it } from "vitest";

import { hashPin, verifyPin } from "./pin";

describe("hashPin / verifyPin", () => {
  it("verifies the correct PIN against its own hash+salt", () => {
    const { hash, salt } = hashPin("482913");
    expect(verifyPin("482913", hash, salt)).toBe(true);
  });

  it("rejects an incorrect PIN", () => {
    const { hash, salt } = hashPin("482913");
    expect(verifyPin("000000", hash, salt)).toBe(false);
  });

  it("produces a different hash+salt on every call, even for the same PIN", () => {
    const a = hashPin("482913");
    const b = hashPin("482913");
    expect(a.salt.equals(b.salt)).toBe(false);
    expect(a.hash.equals(b.hash)).toBe(false);
  });

  it("never throws on a length-mismatched stored hash — fails closed instead", () => {
    const { salt } = hashPin("482913");
    expect(verifyPin("482913", Buffer.from("short"), salt)).toBe(false);
  });
});
