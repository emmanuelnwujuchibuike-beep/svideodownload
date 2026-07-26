import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getExtensibilityAndAi,
  getFrameworkServices,
  getLifecycleAndPlatform,
  getNavigationEngine,
  getRegisteredWorkspaces,
  getShellCapabilities,
  type WorkspaceStatus,
} from "./workspace-platform";
import { getModules } from "./modules";

/**
 * Keeps the Workspace Framework Registry honest (docs/CONSTITUTION.md, Article I.3):
 * a `live`/`partial` row must point at a file that exists, and a `planned` row must
 * not pretend to. This is exactly where an overstated "live" would be most
 * misleading — the brief asks for a micro-frontend / plugin platform this modular
 * MONOLITH does not have, and the map's whole value is saying so mechanically.
 */

const ROOT = path.resolve(__dirname, "../..");

function sourceProblems(entries: { id: string; source: string; status: WorkspaceStatus }[]): string[] {
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

const CATALOGUES: Record<string, { id: string; source: string; status: WorkspaceStatus }[]> = {
  services: getFrameworkServices(),
  shell: getShellCapabilities(),
  navigation: getNavigationEngine(),
  "lifecycle & platform": getLifecycleAndPlatform(),
  "extensibility & AI": getExtensibilityAndAi(),
};

describe("Workspace Framework Registry", () => {
  for (const [name, entries] of Object.entries(CATALOGUES)) {
    it(`${name}: every live/partial row points at a real file, planned rows name none`, () => {
      const problems = sourceProblems(entries);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }

  it("the kernel that exists is honestly live", () => {
    const svc = new Map(getFrameworkServices().map((s) => [s.id, s.status]));
    for (const live of ["workspace-registry", "workspace-contract", "workspace-gateway", "shell-service", "navigation-service", "admin-dashboard"]) {
      expect(svc.get(live), `${live} should be live`).toBe("live");
    }
  });

  it("the micro-frontend / plugin / lifecycle services this monolith lacks are honestly planned", () => {
    const svc = new Map(getFrameworkServices().map((s) => [s.id, s.status]));
    for (const planned of ["plugin-manager", "lifecycle-service"]) {
      expect(svc.get(planned), `${planned} should be planned`).toBe("planned");
    }
    // Independent deployment + version compat are the deliberate exit-path, not built.
    const indep = new Map(getLifecycleAndPlatform().map((l) => [l.id, l.status]));
    expect(indep.get("independent-deploy")).toBe("planned");
    expect(indep.get("version-compat")).toBe("planned");
    // …while the SHARED platform is real and load-bearing.
    for (const shared of ["shared-auth", "shared-design", "shared-analytics", "shared-policies"]) {
      expect(indep.get(shared), `${shared} should be live`).toBe("live");
    }
  });

  it("the whole plugin framework is honestly planned (a security-sensitive sandbox that does not exist)", () => {
    for (const e of getExtensibilityAndAi().filter((x) => x.kind === "plugin")) {
      expect(e.status, `${e.id} should be planned`).toBe("planned");
    }
  });

  it("AI UNDERSTANDING has a real machine-readable substrate; runtime reasoning is planned", () => {
    const ai = new Map(getExtensibilityAndAi().filter((x) => x.kind === "ai").map((a) => [a.id, a.status]));
    for (const live of ["ai-onboarding", "ai-registries", "ai-service-contracts", "ai-api-contracts", "ai-event-contracts"]) {
      expect(ai.get(live), `${live} should be live`).toBe("live");
    }
    expect(ai.get("ai-runtime")).toBe("planned");
  });

  it("the shell's three navigation surfaces are all live", () => {
    const shell = new Map(getShellCapabilities().map((s) => [s.id, s.status]));
    for (const live of ["global-nav", "top-nav", "bottom-nav", "notifications", "universal-search"]) {
      expect(shell.get(live), `${live} should be live`).toBe("live");
    }
  });
});

describe("registered workspaces — a view over the Product Genome, not a second list", () => {
  it("mirrors the module registry exactly (no drift, no fabrication)", () => {
    const ws = getRegisteredWorkspaces().map((w) => w.id).sort();
    const modules = getModules().map((m) => m.id).sort();
    expect(ws).toEqual(modules);
  });

  it("inherits claimability from the genome — every claimable workspace proves itself with a route", () => {
    // The Reality-Ledger rule is one-directional: claimable ⇒ a real proving route.
    // The reverse does NOT hold — `admin` is real (provingRoute /admin) yet not
    // claimable, because it is internal and never surfaced in marketing.
    for (const w of getRegisteredWorkspaces()) {
      if (w.claimable) {
        expect(w.provingRoute, `${w.id} is claimable but has no proving route`).toBeTruthy();
      }
    }
    const admin = getRegisteredWorkspaces().find((w) => w.id === "admin");
    expect(admin?.claimable, "admin should be real-but-unclaimable").toBe(false);
    expect(admin?.provingRoute, "admin is real, so it keeps a proving route").toBe("/admin");
  });

  it("derives the access tier from the real predicate", () => {
    const byId = new Map(getRegisteredWorkspaces().map((w) => [w.id, w]));
    // download + community are open to everyone; admin is admin-only. Asserted
    // against the derived label so a predicate change is caught here, not shipped.
    expect(byId.get("download")?.tier).toBe("everyone");
    expect(byId.get("community")?.tier).toBe("everyone");
    expect(byId.get("admin")?.tier).toBe("admin");
  });
});

describe("the catalogue check has teeth", () => {
  it("catches a live row pointing at a missing file", () => {
    const problems = sourceProblems([{ id: "ghost", source: "lib/platform/nope.ts", status: "live" }]);
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
});
