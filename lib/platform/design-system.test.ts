import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DESIGN_PRINCIPLES,
  getA11yStandards,
  getMotionPatterns,
  getThemes,
} from "./design-system";

const ROOT = path.resolve(__dirname, "../..");

describe("Design principles", () => {
  it("are non-empty with unique ids", () => {
    expect(DESIGN_PRINCIPLES.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const p of DESIGN_PRINCIPLES) {
      expect(seen.has(p.id), `duplicate principle: ${p.id}`).toBe(false);
      seen.add(p.id);
      expect(p.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("Motion patterns", () => {
  it("every pattern that names a source points at a real file", () => {
    const problems: string[] = [];
    for (const m of getMotionPatterns()) {
      if (m.source && !existsSync(path.join(ROOT, m.source))) {
        problems.push(`"${m.id}" points at "${m.source}", which does not exist`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("every pattern states its reduced-motion behaviour", () => {
    for (const m of getMotionPatterns()) {
      expect(m.reducedMotion.length, `${m.id} has no reduced-motion note`).toBeGreaterThan(0);
    }
  });
});

describe("Accessibility standards", () => {
  it("are non-empty and each says how it is enforced", () => {
    expect(getA11yStandards().length).toBeGreaterThan(0);
    for (const s of getA11yStandards()) {
      expect(s.requirement.length).toBeGreaterThan(0);
      expect(s.howEnforced.length).toBeGreaterThan(0);
    }
  });
});

describe("Themes", () => {
  it("ship light, dark and auto as live; brand/seasonal is honestly planned", () => {
    const byId = new Map(getThemes().map((t) => [t.id, t]));
    expect(byId.get("light")?.status).toBe("live");
    expect(byId.get("dark")?.status).toBe("live");
    expect(byId.get("auto")?.status).toBe("live");
    expect(byId.get("brand-seasonal")?.status).toBe("planned");
  });
});
