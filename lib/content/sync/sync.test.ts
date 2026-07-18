import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  blocksPublish,
  detectDeadBasePaths,
  detectDrift,
  detectMissingMigrations,
  detectMissingRoutes,
  detectStaleVerification,
  detectUnmountedSurfaces,
  type RepoSnapshot,
} from "./detect";
import { buildReport, formatReport, impactOf } from "./impact";
import { scanRoutes, takeSnapshot } from "./snapshot";
import { capabilityId, productId } from "@/lib/content/graph/build";

/**
 * Experience Sync Engine — Phase 5.
 *
 * The engine answers "what on this website is now a lie?", so its own correctness is
 * load-bearing: a false negative means the site keeps making a claim nobody is told
 * is broken, and a false positive trains people to ignore the queue.
 *
 * Detectors are pure over an injected snapshot, so most of this runs on synthetic
 * repositories — that is the only way to test "the route was deleted" without
 * actually deleting a route.
 */

const ROOT = path.resolve(__dirname, "../../..");

/** A snapshot where everything the genome claims is present. */
function healthySnapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    routes: [
      "/", "/downloads", "/home", "/explore", "/reels", "/messages", "/admin",
      "/api/download", "/api/assistant",
    ],
    migrations: ["0084_guest_likes.sql", "0085_content_authoring.sql", "0086_editorial_workflow.sql"],
    files: {},
    now: new Date("2026-07-18T00:00:00Z"),
    ...overrides,
  };
}

describe("Sync Engine — missing routes", () => {
  it("reports nothing when every claim is provable", () => {
    expect(detectMissingRoutes(healthySnapshot())).toHaveLength(0);
  });

  it("flags a claimable product whose proving route was deleted", () => {
    /*
     * The core scenario: someone removes /downloads, the marketing page keeps
     * selling it, and nothing in a normal test suite notices because the copy is
     * still internally consistent.
     */
    const snapshot = healthySnapshot({
      routes: ["/", "/home", "/explore", "/admin", "/api/assistant"],
    });
    const findings = detectMissingRoutes(snapshot);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe("factual-break");
    expect(findings.some((f) => f.nodeId === productId("download"))).toBe(true);
  });

  it("flags a real capability whose proving route vanished", () => {
    const snapshot = healthySnapshot({
      routes: ["/", "/downloads", "/home", "/explore", "/admin"], // no /api/download
    });
    const findings = detectMissingRoutes(snapshot);
    expect(findings.some((f) => f.nodeId === capabilityId("download", "extract"))).toBe(true);
  });

  it("treats a nested route as satisfying its parent claim", () => {
    // /messages/[id] existing means /messages is served; a prefix match is correct.
    const snapshot = healthySnapshot({
      routes: ["/", "/downloads/history", "/home", "/explore", "/admin", "/api/download"],
    });
    expect(detectMissingRoutes(snapshot).some((f) => f.nodeId === productId("download"))).toBe(false);
  });
});

describe("Sync Engine — severity is not uniform", () => {
  it("rates a dead basePath with no nav as stale, not a break", () => {
    /*
     * studio/cloud/smart have dead basePaths today but contribute no nav entries,
     * so nothing is broken for a visitor. Calling that a factual break would make
     * the queue permanently red and therefore ignored.
     */
    const findings = detectDeadBasePaths(healthySnapshot());
    const studio = findings.find((f) => f.nodeId === productId("studio"));
    expect(studio?.severity).toBe("stale");
  });

  it("rates a dead basePath that contributes nav as a break", () => {
    // download has nav entries; removing its route is a live 404.
    const findings = detectDeadBasePaths(healthySnapshot({ routes: ["/", "/home", "/admin"] }));
    const download = findings.find((f) => f.nodeId === productId("download"));
    expect(download?.severity).toBe("factual-break");
  });

  it("never rates age as breakage", () => {
    // Treating an old verifiedAt as a break trains people to bump the date without
    // checking, which is strictly worse than an honest stale marker.
    const old = healthySnapshot({ now: new Date("2030-01-01T00:00:00Z") });
    const findings = detectStaleVerification(old);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.severity === "stale")).toBe(true);
  });

  it("only blocks publish on a factual break", () => {
    expect(blocksPublish(detectStaleVerification(healthySnapshot({ now: new Date("2030-01-01") })))).toBe(false);
    expect(blocksPublish([{ id: "x", severity: "factual-break", nodeId: "n", summary: "s", remedy: "r" }])).toBe(true);
  });
});

describe("Sync Engine — the Smart incident, generalised", () => {
  it("detects a commented-out mount", () => {
    /*
     * Smart was marked `beta` with a live API while <AssistantWidget /> sat
     * commented out of app/layout.tsx. Every record was self-consistent; only
     * reading the mount site catches it.
     */
    const snapshot = healthySnapshot({
      files: {
        "app/layout.tsx": [
          "export default function RootLayout() {",
          "  return <div>",
          "    {/* <AssistantWidget /> temporarily removed — re-add later */}",
          "  </div>;",
          "}",
        ].join("\n"),
      },
    });

    const findings = detectUnmountedSurfaces(snapshot);
    expect(findings.length).toBe(1);
    expect(findings[0]?.summary).toContain("AssistantWidget");
  });

  it("does not flag ordinary commented prose", () => {
    const snapshot = healthySnapshot({
      files: { "app/layout.tsx": "// this component renders the shell\nconst a = 1;" },
    });
    expect(detectUnmountedSurfaces(snapshot)).toHaveLength(0);
  });
});

describe("Sync Engine — migrations", () => {
  it("flags a genome requiring a migration that is not in the repo", () => {
    const snapshot = healthySnapshot({ migrations: ["0001_init.sql"] });
    const findings = detectMissingMigrations(snapshot);
    expect(findings.some((f) => f.severity === "factual-break")).toBe(true);
  });

  it("passes when the required migration is present", () => {
    expect(detectMissingMigrations(healthySnapshot())).toHaveLength(0);
  });
});

describe("Sync Engine — impact analysis", () => {
  it("finds the SEO pages affected by a capability change", () => {
    /*
     * The payoff for Phase 3. Changing audio extraction affects every page that
     * illustrates it — found by traversal, not by remembering they exist.
     */
    const impacted = impactOf(capabilityId("download", "audio-extract"));
    expect(impacted.length).toBeGreaterThan(0);
    expect(impacted.some((i) => i.node.kind === "seoPage")).toBe(true);
  });

  it("traverses inbound edges, not outbound", () => {
    // "What points at this?" — following outbound edges walks away from every
    // dependant and finds nothing.
    const impacted = impactOf(productId("download"));
    expect(impacted.some((i) => i.node.kind === "seoPage")).toBe(true);
  });

  it("returns nearest-first and never includes the origin", () => {
    const impacted = impactOf(productId("download"));
    const distances = impacted.map((i) => i.distance);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(impacted.some((i) => i.node.id === productId("download"))).toBe(false);
  });

  it("respects the hop and result limits", () => {
    const impacted = impactOf(productId("download"), { maxHops: 1, limit: 5 });
    expect(impacted.length).toBeLessThanOrEqual(5);
    expect(impacted.every((i) => i.distance === 1)).toBe(true);
  });

  it("explains why a node is in the blast radius", () => {
    const impacted = impactOf(capabilityId("download", "audio-extract"));
    expect(impacted[0]?.via.length).toBeGreaterThan(0);
  });
});

describe("Sync Engine — reporting", () => {
  it("groups impact by cause, not by affected node", () => {
    // A person fixes one broken route; they do not fix forty pages individually.
    const findings = detectMissingRoutes(healthySnapshot({ routes: ["/", "/home", "/admin"] }));
    const report = buildReport(findings);
    expect(Object.keys(report.impact)).toEqual(findings.map((f) => f.id));
    expect(report.blocked).toBe(true);
  });

  it("says so plainly when nothing has drifted", () => {
    expect(formatReport(buildReport([]))).toContain("No drift detected");
  });

  it("marks a blocked report unmistakably", () => {
    const findings = detectMissingRoutes(healthySnapshot({ routes: ["/", "/admin"] }));
    expect(formatReport(buildReport(findings))).toContain("PUBLISH BLOCKED");
  });
});

describe("Sync Engine — against the real repository", () => {
  const snapshot = takeSnapshot(ROOT);

  it("discovers the app's real routes", () => {
    expect(snapshot.routes).toContain("/");
    expect(snapshot.routes).toContain("/downloads");
    expect(snapshot.routes).toContain("/api/download");
  });

  it("counts a directory as a route only when it serves one", () => {
    // A shared-component folder under app/ is not a URL. Counting it would make the
    // missing-route detector silently pass on a deleted page.
    const routes = scanRoutes(ROOT);
    expect(routes.every((r) => r === "/" || !r.endsWith("/"))).toBe(true);
    expect(routes).not.toContain("/(app)");
    expect(routes).not.toContain("/(marketing)");
  });

  it("reports no factual break on the current tree", () => {
    /*
     * This is the live guard. If someone deletes a route a claimable product
     * depends on, or references a migration that never lands, this fails.
     */
    const findings = detectDrift(snapshot);
    const breaks = findings.filter((f) => f.severity === "factual-break");
    expect(breaks, formatReport(buildReport(breaks))).toHaveLength(0);
  });
});
