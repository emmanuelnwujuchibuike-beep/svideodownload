import { describe, expect, it } from "vitest";

import {
  type Access,
  type Capability,
  can,
  getCapabilities,
} from "./permissions";

const anon: Access = { plan: "free", isAdmin: false };
const pro: Access = { plan: "pro", isAdmin: false };
const business: Access = { plan: "business", isAdmin: false };
const admin: Access = { plan: "free", isAdmin: true };

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function capabilityProblems(caps: Capability[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of caps) {
    if (!KEBAB.test(c.id)) problems.push(`id not kebab-case: "${c.id}"`);
    if (seen.has(c.id)) problems.push(`duplicate id: "${c.id}"`);
    seen.add(c.id);
    if (typeof c.grants !== "function") problems.push(`"${c.id}" has no grant predicate`);
  }
  return problems;
}

describe("Permission Registry — integrity", () => {
  it("capability ids are unique, kebab-case, with a predicate", () => {
    const problems = capabilityProblems(getCapabilities());
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("Permission Registry — the grant matrix", () => {
  it("public is granted to everyone", () => {
    for (const a of [anon, pro, business, admin]) expect(can(a, "public")).toBe(true);
  });
  it("pro is any paid tier (pro or business), not free", () => {
    expect(can(anon, "pro")).toBe(false);
    expect(can(pro, "pro")).toBe(true);
    expect(can(business, "pro")).toBe(true);
  });
  it("business is business-only", () => {
    expect(can(pro, "business")).toBe(false);
    expect(can(business, "business")).toBe(true);
  });
  it("admin follows the isAdmin flag, independent of plan", () => {
    expect(can(anon, "admin")).toBe(false);
    expect(can(admin, "admin")).toBe(true);
    // A paid plan does not confer admin.
    expect(can(business, "admin")).toBe(false);
  });
  it("an unknown capability fails closed", () => {
    expect(can(admin, "nonexistent")).toBe(false);
  });
});

describe("Permission Registry — the check has teeth", () => {
  it("catches a bad id, a duplicate, and a missing predicate", () => {
    const broken = [
      { id: "Bad_Id", label: "", description: "", grants: () => true },
      { id: "dup", label: "", description: "", grants: () => true },
      { id: "dup", label: "", description: "", grants: () => true },
      { id: "no-pred", label: "", description: "", grants: undefined },
    ] as unknown as Capability[];
    const problems = capabilityProblems(broken);
    expect(problems.some((p) => p.includes("not kebab-case"))).toBe(true);
    expect(problems.some((p) => p.includes("duplicate id"))).toBe(true);
    expect(problems.some((p) => p.includes("no grant predicate"))).toBe(true);
  });
});
