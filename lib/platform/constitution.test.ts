import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ADMIN_CATEGORIES,
  ADMIN_SECTIONS,
  DEFAULT_ADMIN_SECTION,
} from "@/lib/admin/sections";

import { type Experiment, getExperiments } from "./experiments";
import { type FeatureFlag, getFlags } from "./flags";

/**
 * The Constitution, made a build gate. See `docs/CONSTITUTION.md` → Article I.6:
 * "every rule ships with an enforcer that can see it fail." These are the rules
 * that types alone do not catch, on the systems most recently added.
 *
 * What this DOESN'T cover (owned elsewhere, not duplicated here):
 *   - Marketing truth / proving routes → `lib/content/reality-ledger.test.ts`.
 *   - Cross-module import boundaries    → `no-restricted-imports` (ESLint).
 *
 * What it DOES cover:
 *   1. Flag registry integrity     (ids, consumers, rollout ranges).
 *   2. Experiment registry integrity (arms, weights, a live test that can enrol).
 *   3. Admin section ↔ panel ↔ icon wiring — the unreachable-section defect that
 *      has bitten this project three times (a section in the nav with no panel,
 *      or an icon the shell can't resolve, both fail silently in the UI).
 *
 * Each detector is a pure function tested twice: against the real data (must be
 * clean) and against a deliberately broken fixture (must be caught) — the same
 * "does the gate still have teeth?" discipline as the reality-ledger suite.
 */

const ROOT = path.resolve(__dirname, "../..");
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/* ------------------------------ detectors ---------------------------------- */

export function flagRegistryProblems(flags: FeatureFlag[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const f of flags) {
    if (!f.id) problems.push("a flag has an empty id");
    else if (!KEBAB.test(f.id)) problems.push(`flag id not kebab-case: "${f.id}"`);
    if (seen.has(f.id)) problems.push(`duplicate flag id: "${f.id}"`);
    seen.add(f.id);
    if (!f.consumer || !f.consumer.trim()) {
      // A flag nothing reads is a knob wired to nothing — declare its consumer,
      // even if only "pending", so an orphaned toggle is a deliberate note.
      problems.push(`flag "${f.id}" declares no consumer`);
    }
    if (f.rollout !== undefined && (f.rollout < 0 || f.rollout > 100)) {
      problems.push(`flag "${f.id}" rollout out of range: ${f.rollout}`);
    }
  }
  return problems;
}

export function experimentRegistryProblems(experiments: Experiment[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const STATUSES = ["draft", "running", "concluded"];
  for (const e of experiments) {
    if (!e.id) problems.push("an experiment has an empty id");
    else if (!KEBAB.test(e.id)) problems.push(`experiment id not kebab-case: "${e.id}"`);
    if (seen.has(e.id)) problems.push(`duplicate experiment id: "${e.id}"`);
    seen.add(e.id);
    if (!STATUSES.includes(e.status)) problems.push(`experiment "${e.id}" bad status: "${e.status}"`);

    if (e.variants.length < 2) {
      problems.push(`experiment "${e.id}" needs ≥2 variants, has ${e.variants.length}`);
    }
    const vseen = new Set<string>();
    let total = 0;
    for (const v of e.variants) {
      if (!v.id || !KEBAB.test(v.id)) problems.push(`experiment "${e.id}" variant id not kebab-case: "${v.id}"`);
      if (vseen.has(v.id)) problems.push(`experiment "${e.id}" duplicate variant: "${v.id}"`);
      vseen.add(v.id);
      if (!Number.isFinite(v.weight) || v.weight < 0) {
        problems.push(`experiment "${e.id}" variant "${v.id}" bad weight: ${v.weight}`);
      }
      total += Math.max(0, v.weight);
    }
    // A RUNNING test with zero total weight enrols everyone into control while
    // claiming to be live — the assignment silently does nothing. Draft/concluded
    // are exempt: they intentionally don't enrol.
    if (e.status === "running" && total <= 0) {
      problems.push(`experiment "${e.id}" is running but every weight is 0`);
    }
  }
  return problems;
}

export function adminWiringProblems(
  sections: typeof ADMIN_SECTIONS,
  categoryIds: Set<string>,
  defaultId: string,
  pageSrc: string,
  shellSrc: string,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let defaultFound = false;
  for (const s of sections) {
    if (seen.has(s.id)) problems.push(`duplicate admin section id: "${s.id}"`);
    seen.add(s.id);
    if (s.id === defaultId) defaultFound = true;
    if (!categoryIds.has(s.category)) problems.push(`section "${s.id}" has unknown category "${s.category}"`);
    // The recurring defect: a section declared in the nav with no panel rendered.
    if (!pageSrc.includes(`<AdminPanel id="${s.id}"`)) {
      problems.push(`section "${s.id}" has no <AdminPanel> in app/admin/page.tsx`);
    }
    // A section whose icon the shell's ICONS map doesn't know renders a silent
    // fallback glyph — caught here rather than in the operator's face.
    if (!new RegExp(`\\b${s.icon}\\b`).test(shellSrc)) {
      problems.push(`section "${s.id}" icon "${s.icon}" is not registered in admin-shell.tsx`);
    }
  }
  if (!defaultFound) problems.push(`DEFAULT_ADMIN_SECTION "${defaultId}" is not a real section`);
  return problems;
}

/* --------------------------- real data is clean ---------------------------- */

describe("Constitution — flag registry", () => {
  it("is internally consistent", () => {
    const problems = flagRegistryProblems(getFlags());
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("Constitution — experiment registry", () => {
  it("is internally consistent", () => {
    const problems = experimentRegistryProblems(getExperiments());
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

describe("Constitution — admin wiring", () => {
  it("every section has a panel and a resolvable icon", () => {
    const pageSrc = readFileSync(path.join(ROOT, "app/admin/page.tsx"), "utf8");
    const shellSrc = readFileSync(path.join(ROOT, "features/admin/admin-shell.tsx"), "utf8");
    const categoryIds = new Set(ADMIN_CATEGORIES.map((c) => c.id));
    const problems = adminWiringProblems(
      ADMIN_SECTIONS,
      categoryIds,
      DEFAULT_ADMIN_SECTION,
      pageSrc,
      shellSrc,
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("reads a real, non-empty admin page (guards against a moved file)", () => {
    // Without this, a renamed page.tsx makes the wiring test pass vacuously.
    const pageSrc = readFileSync(path.join(ROOT, "app/admin/page.tsx"), "utf8");
    expect(pageSrc).toContain("<AdminShell>");
  });
});

/* ------------------------- the detectors have teeth ------------------------ */

describe("Constitution — the gate can fail", () => {
  it("flags: catches a non-kebab id, a missing consumer and a bad rollout", () => {
    const broken = [
      { id: "Bad_Id", label: "x", description: "", category: "product", defaultEnabled: false, consumer: "y" },
      { id: "no-consumer", label: "x", description: "", category: "product", defaultEnabled: false, consumer: " " },
      { id: "over", label: "x", description: "", category: "product", defaultEnabled: false, consumer: "y", rollout: 140 },
    ] as unknown as FeatureFlag[];
    expect(flagRegistryProblems(broken).length).toBeGreaterThanOrEqual(3);
  });

  it("flags: catches a duplicate id", () => {
    const dup = [
      { id: "dup", label: "x", description: "", category: "product", defaultEnabled: false, consumer: "y" },
      { id: "dup", label: "x", description: "", category: "product", defaultEnabled: false, consumer: "y" },
    ] as unknown as FeatureFlag[];
    expect(flagRegistryProblems(dup)).toContain('duplicate flag id: "dup"');
  });

  it("experiments: catches a single-arm test and a running test with no weight", () => {
    const oneArm = [
      { id: "solo", label: "x", description: "", status: "running", variants: [{ id: "a", weight: 1 }] },
    ] as unknown as Experiment[];
    expect(experimentRegistryProblems(oneArm).some((p) => p.includes("≥2 variants"))).toBe(true);

    const zeroWeight = [
      {
        id: "flat",
        label: "x",
        description: "",
        status: "running",
        variants: [{ id: "a", weight: 0 }, { id: "b", weight: 0 }],
      },
    ] as unknown as Experiment[];
    expect(experimentRegistryProblems(zeroWeight).some((p) => p.includes("every weight is 0"))).toBe(true);
  });

  it("admin: catches a section with no panel and an unregistered icon", () => {
    const sections = [
      { id: "ghost", label: "Ghost", category: "system", icon: "Nonexistent", blurb: "" },
    ] as unknown as typeof ADMIN_SECTIONS;
    const problems = adminWiringProblems(
      sections,
      new Set(["system"]),
      "ghost",
      "<AdminShell></AdminShell>", // no <AdminPanel id="ghost">
      "const ICONS = { Activity };", // no "Nonexistent"
    );
    expect(problems.some((p) => p.includes("no <AdminPanel>"))).toBe(true);
    expect(problems.some((p) => p.includes("not registered"))).toBe(true);
  });

  it("admin: catches a default section id that doesn't exist", () => {
    const sections = [
      { id: "real", label: "Real", category: "system", icon: "Activity", blurb: "" },
    ] as unknown as typeof ADMIN_SECTIONS;
    const problems = adminWiringProblems(
      sections,
      new Set(["system"]),
      "typo-default",
      '<AdminPanel id="real">',
      "Activity",
    );
    expect(problems.some((p) => p.includes("is not a real section"))).toBe(true);
  });
});
