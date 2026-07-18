/**
 * Navigation queries — the one place ranking, filtering and workspace availability
 * are decided. Every surface (palette, switcher, adaptive nav, search) calls these
 * rather than reimplementing them, which is what stops the five surfaces drifting.
 *
 * Pure and synchronous: no I/O, no async. Safe in a server render, a client
 * component, or a test.
 */
import { getModule } from "@/lib/platform/modules";
import type { ModuleAccess } from "@/lib/platform/module-registry";

import { COMMANDS, DESTINATIONS, WORKSPACES } from "./registry";
import type { Command, Destination, NavResult, Workspace, WorkspaceId } from "./types";

/** The viewer, as navigation sees them. */
export interface NavViewer extends ModuleAccess {
  signedIn: boolean;
}

export const GUEST: NavViewer = { plan: "free", isAdmin: false, signedIn: false };

/* -------------------------------- filtering --------------------------------- */

function permitted<T extends { canAccess: (a: ModuleAccess) => boolean; requiresAuth?: boolean }>(
  items: T[],
  viewer: NavViewer,
): T[] {
  return items.filter((i) => {
    // Signed-out visitors are HIDDEN from auth-only entries rather than shown them
    // and bounced to /login. Offering an action that immediately rejects you is a
    // worse experience than not offering it, and it inflates the palette with
    // things a guest cannot do.
    if (i.requiresAuth && !viewer.signedIn) return false;
    return i.canAccess(viewer);
  });
}

export function destinationsFor(viewer: NavViewer): Destination[] {
  return permitted(DESTINATIONS, viewer);
}

export function commandsFor(viewer: NavViewer): Command[] {
  return permitted(COMMANDS, viewer);
}

/* -------------------------------- workspaces -------------------------------- */

/**
 * Workspaces the switcher may offer.
 *
 * A workspace is only real if the product behind it is `claimable` in the Product
 * Genome. The brief lists eleven; today two qualify. This is the Reality Ledger
 * applied to navigation: without it the switcher would offer Cloud, Marketplace and
 * Enterprise environments that do not exist — the same promise the product grid was
 * making before Phase 1.
 *
 * Enforced here rather than at each call site so no future surface can forget it.
 */
export function availableWorkspaces(viewer: NavViewer): Workspace[] {
  return WORKSPACES.filter((w) => {
    const product = getModule(w.productId);
    if (!product?.veracity.claimable) return false;
    return w.canAccess(viewer);
  });
}

/** The workspace that owns a pathname, by longest `home` match. */
export function resolveWorkspace(pathname: string): Workspace | undefined {
  return WORKSPACES.filter((w) => pathname === w.home || pathname.startsWith(`${w.home}/`)).sort(
    (a, b) => b.home.length - a.home.length,
  )[0];
}

export function workspaceDestinations(id: WorkspaceId, viewer: NavViewer): Destination[] {
  return destinationsFor(viewer).filter((d) => d.workspace === id);
}

/* --------------------------------- ranking ---------------------------------- */

/**
 * Score a candidate against a query.
 *
 * Tiered rather than fuzzy, deliberately. A fuzzy/edit-distance matcher ranks
 * unpredictably — the same keystroke can reorder the list — and in a palette the
 * top hit is usually chosen blind, on muscle memory. Predictable beats clever here:
 *
 *   exact label            1000
 *   label starts with      900   ("mes" → Messages)
 *   word in label starts   800   ("set" → Account settings)
 *   label contains         600
 *   keyword starts with    500   ("logout" → Sign out)
 *   keyword contains       300
 *   subsequence            120   ("acst" → Account settings), last resort
 *
 * Returns 0 for no match so callers can filter on truthiness.
 */
export function score(query: string, label: string, keywords: string[] = []): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const l = label.toLowerCase();
  if (l === q) return 1000;
  if (l.startsWith(q)) return 900;
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 800;
  if (l.includes(q)) return 600;

  for (const k of keywords) {
    const kw = k.toLowerCase();
    if (kw.startsWith(q)) return 500;
    if (kw.includes(q)) return 300;
  }

  // Subsequence: every query character appears in order. Catches initialisms and
  // typo-ish input without the instability of a full fuzzy score.
  let i = 0;
  for (const ch of l) if (ch === q[i]) i++;
  return i === q.length ? 120 : 0;
}

/**
 * The palette's result list: destinations + commands, ranked.
 *
 * With an empty query this returns a useful DEFAULT set rather than nothing — an
 * empty palette on open makes the user do the work of guessing what it knows.
 */
export function searchNavigation(
  query: string,
  viewer: NavViewer,
  limit = 12,
): NavResult[] {
  const dests = destinationsFor(viewer);
  const cmds = commandsFor(viewer);

  if (!query.trim()) {
    // Defaults: the create commands and the most-used destinations, in registry
    // order so the list is stable between opens.
    const featured: NavResult[] = [
      ...cmds.filter((c) => c.group === "create").slice(0, 3).map((c) => toCommandResult(c, 0)),
      ...dests.filter((d) => d.kind === "page" || d.kind === "product").slice(0, 6).map((d) => toDestResult(d, 0)),
    ];
    return featured.slice(0, limit);
  }

  const results: NavResult[] = [];
  for (const d of dests) {
    const s = score(query, d.label, d.keywords);
    if (s > 0) results.push(toDestResult(d, s));
  }
  for (const c of cmds) {
    const s = score(query, c.label, c.keywords);
    // Commands edge out destinations at equal score: if someone types a verb, they
    // mean to DO the thing, not read about it.
    if (s > 0) results.push(toCommandResult(c, s + 10));
  }

  return results
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}

function toDestResult(d: Destination, s: number): NavResult {
  return { kind: "destination", id: d.id, label: d.label, href: d.href, hint: d.hint, icon: d.icon, score: s };
}

function toCommandResult(c: Command, s: number): NavResult {
  return { kind: "command", id: c.id, label: c.label, href: c.href, hint: c.hint, icon: c.icon, score: s };
}

/* -------------------------------- integrity --------------------------------- */

export interface NavIssue {
  id: string;
  problem: string;
}

/**
 * Registry problems, returned as data so the test suite and a future admin panel
 * share one check — the same pattern as `auditGenomes()` and `auditGraph()`.
 *
 * Route EXISTENCE is not checked here: it needs the filesystem, which would make
 * this module unimportable from the client. `navigation.test.ts` does it.
 */
export function auditNavigation(): NavIssue[] {
  const issues: NavIssue[] = [];

  const seen = new Set<string>();
  for (const item of [...DESTINATIONS, ...COMMANDS]) {
    if (seen.has(item.id)) issues.push({ id: item.id, problem: "duplicate id" });
    seen.add(item.id);
  }

  for (const d of DESTINATIONS) {
    if (!d.href.startsWith("/")) issues.push({ id: d.id, problem: `href "${d.href}" is not absolute` });
    if (d.workspace && !WORKSPACES.some((w) => w.id === d.workspace)) {
      issues.push({ id: d.id, problem: `unknown workspace "${d.workspace}"` });
    }
  }

  for (const c of COMMANDS) {
    if (!c.href && !c.action) issues.push({ id: c.id, problem: "command has neither href nor action" });
    if (c.href && c.action) issues.push({ id: c.id, problem: "command has both href and action" });
  }

  for (const w of WORKSPACES) {
    if (!w.home.startsWith("/")) issues.push({ id: w.id, problem: `home "${w.home}" is not absolute` });
  }

  return issues;
}
