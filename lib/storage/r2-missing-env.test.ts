import { describe, expect, it } from "vitest";

import { r2MissingEnv } from "./r2";

const ALL = {
  R2_ACCOUNT_ID: "a",
  R2_ACCESS_KEY_ID: "k",
  R2_SECRET_ACCESS_KEY: "s",
  R2_BUCKET: "frenzsave",
  R2_PUBLIC_BASE_URL: "https://media.example",
  R2_PRIVATE_BUCKET: "frenzsave-private",
};

/** The admin's worker check names the storage variables the worker can't see (owner, 2026-10-30) — names, never values. */
describe("r2MissingEnv", () => {
  it("nothing missing when every variable is set", () => {
    expect(r2MissingEnv(ALL)).toEqual([]);
  });

  it("names exactly the unset or blank ones (teeth: a blank value is missing, not set)", () => {
    expect(r2MissingEnv({ ...ALL, R2_PUBLIC_BASE_URL: undefined, R2_SECRET_ACCESS_KEY: "  " })).toEqual(["R2_SECRET_ACCESS_KEY", "R2_PUBLIC_BASE_URL"]);
    expect(r2MissingEnv({})).toHaveLength(6);
  });

  it("a private bucket equal to the public one is named too", () => {
    expect(r2MissingEnv({ ...ALL, R2_PRIVATE_BUCKET: "frenzsave" })).toEqual(["R2_PRIVATE_BUCKET (same as R2_BUCKET)"]);
  });

  it("never returns a value", () => {
    expect(r2MissingEnv({ ...ALL, R2_BUCKET: undefined }).join(" ")).not.toContain("frenzsave-private");
  });
});
