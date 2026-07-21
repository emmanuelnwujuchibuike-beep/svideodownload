import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { gateSummary, getGates, type GovernanceGate } from "./governance";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPTS: Record<string, string> =
  JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts ?? {};

/** Pure detector: a gate must point at something that actually enforces it. */
function gateProblems(gates: GovernanceGate[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const g of gates) {
    if (seen.has(g.id)) problems.push(`duplicate gate id: "${g.id}"`);
    seen.add(g.id);
    switch (g.kind) {
      case "test":
      case "config":
        if (!g.enforcer) problems.push(`"${g.id}" (${g.kind}) names no enforcer path`);
        else if (!existsSync(path.join(ROOT, g.enforcer))) {
          problems.push(`"${g.id}" points at "${g.enforcer}", which does not exist`);
        }
        break;
      case "command":
        if (!SCRIPTS[g.enforcer]) problems.push(`"${g.id}" needs npm script "${g.enforcer}", not in package.json`);
        break;
      case "manual":
        if (g.enforcer && !existsSync(path.join(ROOT, g.enforcer))) {
          problems.push(`"${g.id}" manual doc "${g.enforcer}" does not exist`);
        }
        break;
      case "planned":
        if (g.enforcer !== "") problems.push(`"${g.id}" is planned but names an enforcer`);
        break;
    }
  }
  return problems;
}

describe("Governance manifest", () => {
  it("every gate points at something that actually enforces it", () => {
    const problems = gateProblems(getGates());
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("the summary counts add up", () => {
    const s = gateSummary();
    expect(s.automated + s.manual + s.planned).toBe(s.total);
    expect(s.total).toBe(getGates().length);
    // We should actually have automated gates — a governance manifest that is all
    // prose (manual/planned) is the thing this whole exercise is against.
    expect(s.automated).toBeGreaterThan(5);
  });
});

describe("the governance check has teeth", () => {
  it("catches a test gate pointing at a missing file", () => {
    const p = gateProblems([{ id: "x", name: "", requirement: "", domain: "process", kind: "test", enforcer: "lib/nope.test.ts" }]);
    expect(p.some((m) => m.includes("does not exist"))).toBe(true);
  });
  it("catches a command gate naming a script that doesn't exist", () => {
    const p = gateProblems([{ id: "x", name: "", requirement: "", domain: "process", kind: "command", enforcer: "nonexistent-script" }]);
    expect(p.some((m) => m.includes("not in package.json"))).toBe(true);
  });
  it("catches a planned gate that pretends to be enforced", () => {
    const p = gateProblems([{ id: "x", name: "", requirement: "", domain: "process", kind: "planned", enforcer: "something" }]);
    expect(p.some((m) => m.includes("planned but names an enforcer"))).toBe(true);
  });
});
