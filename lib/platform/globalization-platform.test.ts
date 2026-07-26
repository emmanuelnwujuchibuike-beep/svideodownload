import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getCurrencyCapabilities,
  getGlobalizationAi,
  getGlobalizationServices,
  getLocalizationSurfaces,
  getRegionalFormats,
  getSupportedLocales,
  getTimezoneCapabilities,
  type GlobalizationStatus,
} from "./globalization-platform";
import { coverage } from "../i18n/locales";

/**
 * Keeps the Globalization Registry honest (docs/CONSTITUTION.md, Article I.3): a
 * `live`/`partial` row must point at a file that exists, and a `planned` row must
 * not pretend to. Localization is exactly where an overstated "live" is most
 * damaging — it promises a language, a currency or a timezone the product cannot
 * actually deliver — so the truth rule is enforced mechanically.
 */

const ROOT = path.resolve(__dirname, "../..");

function sourceProblems(entries: { id: string; source: string; status: GlobalizationStatus }[]): string[] {
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

const CATALOGUES: Record<string, { id: string; source: string; status: GlobalizationStatus }[]> = {
  services: getGlobalizationServices(),
  "regional formats": getRegionalFormats(),
  currency: getCurrencyCapabilities(),
  timezone: getTimezoneCapabilities(),
  surfaces: getLocalizationSurfaces(),
  AI: getGlobalizationAi(),
};

describe("Globalization Registry", () => {
  for (const [name, entries] of Object.entries(CATALOGUES)) {
    it(`${name}: every live/partial row points at a real file, planned rows name none`, () => {
      const problems = sourceProblems(entries);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }

  it("ids are unique across the whole platform", () => {
    const all = Object.values(CATALOGUES).flat();
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const e of all) {
      if (seen.has(e.id)) dups.push(e.id);
      seen.add(e.id);
    }
    // Ids only need to be unique WITHIN a catalogue for the shape to work, but a
    // clash across catalogues would make the admin view ambiguous — assert none.
    expect(dups, `duplicate ids across catalogues: ${dups.join(", ")}`).toEqual([]);
  });

  it("the i18n substrate that exists is honestly live", () => {
    const svc = new Map(getGlobalizationServices().map((s) => [s.id, s.status]));
    for (const live of ["locale-registry", "localization", "catalogue", "translation-pipeline", "language-detection", "formatting", "alternates"]) {
      expect(svc.get(live), `${live} should be live`).toBe("live");
    }
  });

  it("the data-plane-only and provider-gated services are honestly partial, not live", () => {
    const svc = new Map(getGlobalizationServices().map((s) => [s.id, s.status]));
    // The content-translation schema is applied but read by nothing yet; claiming
    // it `live` would be the exact overstatement the ledger exists to stop.
    for (const partial of ["content-translation", "currency", "timezone", "regional-config", "analytics", "monitoring"]) {
      expect(svc.get(partial), `${partial} should be partial`).toBe("partial");
    }
  });

  it("content translation points at the migration that actually models it", () => {
    const ct = getGlobalizationServices().find((s) => s.id === "content-translation");
    expect(ct?.source).toBe("supabase/migrations/0086_editorial_workflow.sql");
    expect(existsSync(path.join(ROOT, ct!.source))).toBe(true);
  });

  it("every Intl formatter the app relies on is live", () => {
    const fmt = new Map(getRegionalFormats().map((f) => [f.id, f.status]));
    for (const live of ["date", "time", "number", "currency-format", "relative-time", "list", "text-direction"]) {
      expect(fmt.get(live), `${live} should be live`).toBe("live");
    }
    // Sorting, units, address, phone, paper, holidays are honestly not built.
    for (const planned of ["collation", "units", "address", "phone", "paper", "holidays"]) {
      expect(fmt.get(planned), `${planned} should be planned`).toBe("planned");
    }
  });

  it("true timezone awareness is planned, and quiet hours are not overstated as it", () => {
    const tz = new Map(getTimezoneCapabilities().map((t) => [t.id, t.status]));
    expect(tz.get("quiet-hours")).toBe("partial"); // real, but UTC-window
    for (const planned of ["auto-detection", "manual-selection", "user-preference", "workspace-preference", "tz-scheduling", "calendar", "ai-scheduling"]) {
      expect(tz.get(planned), `${planned} should be planned`).toBe("planned");
    }
  });

  it("the whole AI layer is honestly planned — including translation assistance", () => {
    // The absent machine-translation row is a deliberate position (0086: `machine`
    // must be human-reviewed), not an accidental gap.
    for (const ai of getGlobalizationAi()) {
      expect(ai.status, `${ai.id} should be planned`).toBe("planned");
    }
  });
});

describe("supported locales — fail closed", () => {
  it("marks English live and never offers a locale with no strings", () => {
    const byCode = new Map(getSupportedLocales().map((l) => [l.code, l]));
    expect(byCode.get("en")?.availability).toBe("live");
    for (const l of getSupportedLocales()) {
      if (coverage(l.code) === 0) {
        expect(l.availability, `${l.code} has no strings but is offered`).toBe("planned");
      }
    }
  });

  it("gives every locale an endonym and a coverage percentage that matches availability", () => {
    for (const l of getSupportedLocales()) {
      expect(l.endonym.trim().length, `${l.code} has no endonym`).toBeGreaterThan(0);
      // A locale offered as live/partial must be at the coverage gate; a planned
      // one must be below it. This is the derived-not-declared honesty, asserted.
      if (l.availability === "planned") expect(l.coveragePct).toBeLessThan(90);
      else expect(l.coveragePct).toBeGreaterThanOrEqual(90);
    }
  });
});

describe("the catalogue check has teeth", () => {
  it("catches a live row pointing at a missing file", () => {
    const problems = sourceProblems([{ id: "ghost", source: "lib/i18n/nope.ts", status: "live" }]);
    expect(problems.some((p) => p.includes("does not exist"))).toBe(true);
  });
  it("catches a planned row that pretends to have a source", () => {
    const problems = sourceProblems([{ id: "fake", source: "lib/x.ts", status: "planned" }]);
    expect(problems.some((p) => p.includes("planned but names a source"))).toBe(true);
  });
  it("catches a live row with no source", () => {
    const problems = sourceProblems([{ id: "empty", source: "", status: "live" }]);
    expect(problems.some((p) => p.includes("names no source"))).toBe(true);
  });
  it("catches a duplicate id", () => {
    const problems = sourceProblems([
      { id: "dup", source: "lib/i18n/format.ts", status: "live" },
      { id: "dup", source: "lib/i18n/format.ts", status: "live" },
    ]);
    expect(problems.some((p) => p.includes('duplicate id: "dup"'))).toBe(true);
  });
});
