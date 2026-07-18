/**
 * Experience Sync Engine™ — drift detection. Phase 5 (RFC §6).
 *
 * Answers one question: **what on this website is now a lie?**
 *
 * ── Why detection runs against the CODEBASE, not the database ──────────────────
 *
 * The obvious design diffs content version N against N-1 and flags what changed.
 * That detects EDITING drift, which is not the problem this site has. The problem
 * is the product moving underneath content that stays still — a route deleted, a
 * capability quietly unmounted, a claim that was true in March.
 *
 * So the reference truth here is the repository itself: routes on disk, migrations
 * present, registries in code. That is what caught `Frenzsave Smart` carrying
 * `status: "beta"` while its only UI surface sat commented out of `app/layout.tsx` —
 * a database-only differ would have seen a perfectly consistent record and reported
 * nothing, because the record was internally consistent and externally false.
 *
 * Everything here is pure over injected inputs, so the whole engine is testable
 * without a filesystem, a database, or a running app.
 */
import { getModules } from "@/lib/platform/modules";
import { GENOMES } from "@/lib/content/genome/registry";
import { isRealStage } from "@/lib/content/genome/queries";

/* ---------------------------------- model ----------------------------------- */

/**
 * Severity, which decides what happens next — this is the RFC's CLASSIFY stage.
 *
 * `factual-break` means the site currently states something untrue. It blocks
 * publish, because shipping on top of it compounds the error.
 * `stale` means a claim is unverified or aging, not yet known to be wrong.
 * `cosmetic` is everything batchable.
 */
export type Severity = "factual-break" | "stale" | "cosmetic";

export interface Finding {
  id: string;
  severity: Severity;
  /** Graph node id the finding attaches to, so impact can be traversed from it. */
  nodeId: string;
  summary: string;
  /** What to do about it, in one line. */
  remedy: string;
}

/** What the detectors are given. Injected so every check is testable in isolation. */
export interface RepoSnapshot {
  /** Route paths that exist, e.g. "/downloads", "/api/assistant". */
  routes: string[];
  /** Migration filenames present, e.g. "0085_content_authoring.sql". */
  migrations: string[];
  /** Files whose content is needed for mount checks, keyed by repo-relative path. */
  files: Record<string, string>;
  /** Today, injected so staleness checks are deterministic in tests. */
  now: Date;
}

/* -------------------------------- detectors --------------------------------- */

/**
 * A claimable product, or a real capability, whose proving route no longer exists.
 *
 * This is the highest-value check in the engine: a `provingRoute` is the promise
 * that a claim is real, so a missing one means the site is asserting something it
 * cannot demonstrate. Always a factual break.
 */
export function detectMissingRoutes(snapshot: RepoSnapshot): Finding[] {
  const findings: Finding[] = [];
  const exists = (route: string) =>
    snapshot.routes.some((r) => r === route || r.startsWith(`${route}/`));

  for (const platform of getModules()) {
    const { veracity } = platform;
    if (veracity.claimable && veracity.provingRoute && !exists(veracity.provingRoute)) {
      findings.push({
        id: `route-missing:${platform.id}`,
        severity: "factual-break",
        nodeId: `product:${platform.id}`,
        summary: `${platform.name} is marketed as available but its proving route ${veracity.provingRoute} no longer exists.`,
        remedy: `Restore the route, or set veracity.claimable = false for "${platform.id}".`,
      });
    }

    const genome = GENOMES[platform.id];
    if (!genome) continue;

    for (const cap of genome.capabilities) {
      if (!isRealStage(cap.stage) || !cap.provingRoute) continue;
      if (!exists(cap.provingRoute)) {
        findings.push({
          id: `cap-route-missing:${platform.id}.${cap.id}`,
          severity: "factual-break",
          nodeId: `capability:${platform.id}.${cap.id}`,
          summary: `Capability "${cap.name}" claims stage ${cap.stage} but ${cap.provingRoute} does not exist.`,
          remedy: `Restore the route, or lower the capability's stage.`,
        });
      }
    }
  }

  return findings;
}

/**
 * A product whose basePath has no route — a dead destination.
 *
 * Distinct from the check above and deliberately NOT a factual break: a module with
 * no `nav` entries contributes no links, so nothing is broken for a visitor today.
 * It becomes one the moment an app launcher renders from `getModulesFor()`, which is
 * why it is surfaced rather than ignored.
 */
export function detectDeadBasePaths(snapshot: RepoSnapshot): Finding[] {
  const exists = (route: string) =>
    snapshot.routes.some((r) => r === route || r.startsWith(`${route}/`));

  return getModules()
    .filter((p) => !exists(p.basePath))
    .map((p) => ({
      id: `basepath-dead:${p.id}`,
      severity: (p.nav?.length ? "factual-break" : "stale") as Severity,
      nodeId: `product:${p.id}`,
      summary: `${p.name} declares basePath ${p.basePath}, which has no route.${
        p.nav?.length ? " It contributes nav links, so this is a live 404." : ""
      }`,
      remedy: `Build ${p.basePath}, or drop the module from launcher surfaces.`,
    }));
}

/**
 * A product marked real whose UI surface is commented out.
 *
 * Generalises the Smart incident: the registry said `beta`, the API existed, and the
 * only mounted component had been commented out with "temporarily removed". Every
 * individual record was self-consistent. Only a check that reads the mount site
 * catches it.
 */
export function detectUnmountedSurfaces(snapshot: RepoSnapshot): Finding[] {
  const findings: Finding[] = [];

  for (const [path, source] of Object.entries(snapshot.files)) {
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("//") && !trimmed.startsWith("{/*") && !trimmed.startsWith("/*")) continue;
      // A commented-out JSX mount, e.g. `// <AssistantWidget />`.
      const match = trimmed.match(/<([A-Z][A-Za-z0-9_]*)\s*\/?>/);
      if (!match) continue;

      findings.push({
        id: `unmounted:${path}:${match[1]}`,
        severity: "stale",
        nodeId: "product:smart",
        summary: `<${match[1]} /> is commented out in ${path}. If a product's veracity depends on it, that product is not reachable.`,
        remedy: `Re-mount it, or confirm the owning product is marked unclaimable.`,
      });
    }
  }

  return findings;
}

/**
 * Veracity records no human has re-confirmed recently.
 *
 * Never a factual break — an old `verifiedAt` means unverified, not wrong. Treating
 * age as breakage would train people to bump the date without checking, which is
 * strictly worse than an honest stale marker.
 */
export function detectStaleVerification(snapshot: RepoSnapshot, days = 90): Finding[] {
  const cutoff = snapshot.now.getTime() - days * 864e5;

  return getModules()
    .filter((p) => {
      const at = p.veracity.verifiedAt;
      return !at || Number.isNaN(Date.parse(at)) || Date.parse(at) < cutoff;
    })
    .map((p) => ({
      id: `stale-veracity:${p.id}`,
      severity: "stale" as Severity,
      nodeId: `product:${p.id}`,
      summary: `${p.name} was last verified ${p.veracity.verifiedAt ?? "never"}.`,
      remedy: `Re-confirm the record against the running product and update verifiedAt.`,
    }));
}

/**
 * A genome referencing a migration that is not in the repository.
 *
 * Catches the reverse of the usual drift: content promising a capability whose
 * schema was never applied or was rolled back.
 */
export function detectMissingMigrations(snapshot: RepoSnapshot): Finding[] {
  const findings: Finding[] = [];
  const present = new Set(snapshot.migrations.map((m) => m.slice(0, 4)));

  for (const genome of Object.values(GENOMES)) {
    for (const compat of genome.compatibility) {
      if (compat.subject !== "migration") continue;
      const required = compat.min.padStart(4, "0");
      if (!present.has(required)) {
        findings.push({
          id: `migration-missing:${genome.id}:${required}`,
          severity: "factual-break",
          nodeId: `product:${genome.id}`,
          summary: `${genome.id} requires migration ${required}, which is not in supabase/migrations.`,
          remedy: `Add the migration, or correct the genome's compatibility range.`,
        });
      }
    }
  }

  return findings;
}

/* ---------------------------------- runner ----------------------------------- */

/** Every detector, in one pass. Order is stable so reports diff cleanly. */
export function detectDrift(snapshot: RepoSnapshot): Finding[] {
  return [
    ...detectMissingRoutes(snapshot),
    ...detectMissingMigrations(snapshot),
    ...detectDeadBasePaths(snapshot),
    ...detectUnmountedSurfaces(snapshot),
    ...detectStaleVerification(snapshot),
  ].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.id.localeCompare(b.id));
}

export function severityRank(s: Severity): number {
  return s === "factual-break" ? 0 : s === "stale" ? 1 : 2;
}

/** Whether findings should block a publish. Only factual breaks do. */
export function blocksPublish(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "factual-break");
}
