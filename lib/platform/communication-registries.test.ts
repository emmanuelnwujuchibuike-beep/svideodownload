import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getAiCapabilities } from "./ai-capabilities";
import { getDomainEvents } from "./domain-events";
import { getIntegrations } from "./integration-registry";

const ROOT = path.resolve(__dirname, "../..");
const DOT = /^[a-z0-9]+(?:\.[a-z0-9]+)+$/;

/** Shared source-path detector (same rule as the platform catalogue). */
function sourceProblems(
  entries: { id: string; source: string; status: "live" | "partial" | "planned" | "internal" }[],
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) problems.push(`duplicate id: "${e.id}"`);
    seen.add(e.id);
    if (e.status === "planned") {
      if (e.source !== "") problems.push(`"${e.id}" is planned but names a source`);
    } else if (!e.source) {
      problems.push(`"${e.id}" is ${e.status} but names no source`);
    } else if (!existsSync(path.join(ROOT, e.source))) {
      problems.push(`"${e.id}" points at "${e.source}", which does not exist`);
    }
  }
  return problems;
}

describe("Domain Event Registry", () => {
  it("ids are dot.case and unique, with a documented payload", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const e of getDomainEvents()) {
      if (!DOT.test(e.id)) problems.push(`id not dot.case: "${e.id}"`);
      if (seen.has(e.id)) problems.push(`duplicate id: "${e.id}"`);
      seen.add(e.id);
      if (e.payload.length === 0) problems.push(`"${e.id}" documents no payload`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("Integration Registry", () => {
  it("every live/partial integration points at a real file; planned name none", () => {
    const problems = sourceProblems(getIntegrations());
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("names a broker and a service mesh, both honestly planned (not faked)", () => {
    const byId = new Map(getIntegrations().map((i) => [i.id, i]));
    expect(byId.get("message-broker")?.status).toBe("planned");
    expect(byId.get("service-mesh")?.status).toBe("planned");
  });
});

describe("AI Capability Registry", () => {
  it("every capability with a source points at a real file", () => {
    // `internal`/`live` capabilities must be backed by real code.
    const problems = sourceProblems(getAiCapabilities());
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("communication catalogues — the source check has teeth", () => {
  it("catches a live entry pointing at a missing file", () => {
    const p = sourceProblems([{ id: "x", source: "lib/platform/nope.ts", status: "live" }]);
    expect(p.some((m) => m.includes("does not exist"))).toBe(true);
  });
  it("catches a planned entry that pretends to have a source", () => {
    const p = sourceProblems([{ id: "y", source: "lib/x.ts", status: "planned" }]);
    expect(p.some((m) => m.includes("planned but names a source"))).toBe(true);
  });
});
