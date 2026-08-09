/**
 * Profile version history (Feature 18 · Part 20).
 *
 * ── The gap this fills ───────────────────────────────────────────────────
 * Twenty parts added type, sections, order, audiences, theme, surface, radius
 * and text scale — and no way back. A member who rearranged their profile and
 * disliked it had to remember what it was. The brief calls it "undo
 * mistakes", and that is exactly right: this is undo, not a feature.
 *
 * ── What a version is ────────────────────────────────────────────────────
 * A snapshot of the member's own LAYOUT CHOICES: profile type, module
 * on/off/order/audience, and appearance. Deliberately NOT their content —
 * posts, photos and credentials are not layout, they are the member's work,
 * and restoring a two-week-old "profile" that silently deleted a post would
 * be a catastrophe dressed as a feature. Restore only ever moves furniture.
 *
 * ── Why snapshots and not a diff log ─────────────────────────────────────
 * A diff chain has to replay correctly from the beginning to produce any
 * version, so one corrupt entry poisons everything after it, and a schema
 * change means rewriting history. A whole snapshot is a few hundred bytes,
 * restores in one write, and is independently valid. The diff is computed for
 * DISPLAY only, from two snapshots, where being wrong is cosmetic.
 *
 * Pure: no React, no Supabase, no I/O.
 */

export interface VersionModule {
  key: string;
  enabled: boolean;
  position: number;
  audience: string;
}

export interface ProfileSnapshot {
  type: string;
  landing: string | null;
  modules: VersionModule[];
  theme: string | null;
  surface: string | null;
  radius: string | null;
  fontScale: string | null;
}

export interface ProfileVersion {
  id: string;
  createdAt: string;
  /** What changed, in a few words. Generated, never typed by the member. */
  label: string;
  snapshot: ProfileSnapshot;
}

/**
 * Versions kept per member.
 *
 * Twenty is enough to undo a bad afternoon and small enough that the list is
 * readable and the table never becomes a storage problem. Unbounded history
 * for a settings screen is a cost with no matching benefit — nobody restores
 * their profile to a state from four hundred edits ago.
 */
export const MAX_VERSIONS = 20;

/** Stable key for a module row. */
const byKey = (modules: readonly VersionModule[]) => new Map(modules.map((m) => [m.key, m]));

export interface VersionChange {
  kind: "type" | "landing" | "theme" | "surface" | "radius" | "fontScale" | "module" | "order" | "audience";
  /** One human sentence. */
  text: string;
}

/**
 * What changed between two snapshots, in the order a person would notice.
 *
 * Used for the LABEL and the "what changed" line. It is descriptive, not
 * exhaustive: listing eleven reordered sections helps nobody, so a reorder is
 * one line however many rows moved.
 */
export function diffSnapshots(before: ProfileSnapshot | null, after: ProfileSnapshot): VersionChange[] {
  if (!before) return [{ kind: "type", text: "First saved version" }];

  const changes: VersionChange[] = [];

  if (before.type !== after.type) {
    changes.push({ kind: "type", text: `Profile type changed to ${after.type}` });
  }
  if (before.theme !== after.theme) {
    changes.push({ kind: "theme", text: after.theme ? `Theme set to ${after.theme}` : "Theme reset to default" });
  }
  if (before.surface !== after.surface) {
    changes.push({ kind: "surface", text: after.surface ? `Cards set to ${after.surface}` : "Cards reset to default" });
  }
  if (before.radius !== after.radius) {
    changes.push({ kind: "radius", text: after.radius ? `Corners set to ${after.radius}` : "Corners reset to default" });
  }
  if (before.fontScale !== after.fontScale) {
    changes.push({
      kind: "fontScale",
      text: after.fontScale ? `Text size set to ${after.fontScale}` : "Text size reset to default",
    });
  }
  if (before.landing !== after.landing) {
    changes.push({
      kind: "landing",
      text: after.landing ? `Visitors now land on ${after.landing}` : "Landing section set to automatic",
    });
  }

  const beforeModules = byKey(before.modules);
  const afterModules = byKey(after.modules);

  const turnedOn: string[] = [];
  const turnedOff: string[] = [];
  let audienceChanges = 0;

  for (const [key, next] of afterModules) {
    const prev = beforeModules.get(key);
    if (!prev) {
      if (next.enabled) turnedOn.push(key);
      continue;
    }
    if (prev.enabled !== next.enabled) (next.enabled ? turnedOn : turnedOff).push(key);
    if (prev.audience !== next.audience) audienceChanges += 1;
  }
  for (const [key, prev] of beforeModules) {
    if (!afterModules.has(key) && prev.enabled) turnedOff.push(key);
  }

  if (turnedOn.length) changes.push({ kind: "module", text: `Turned on ${list(turnedOn)}` });
  if (turnedOff.length) changes.push({ kind: "module", text: `Turned off ${list(turnedOff)}` });
  if (audienceChanges > 0) {
    changes.push({
      kind: "audience",
      text: audienceChanges === 1 ? "Changed who can see a section" : `Changed who can see ${audienceChanges} sections`,
    });
  }

  // Reorder is ONE line however many rows moved — a list of eleven shuffled
  // sections is noise, not information.
  if (orderChanged(before.modules, after.modules) && !changes.some((c) => c.kind === "module")) {
    changes.push({ kind: "order", text: "Reordered your sections" });
  }

  return changes;
}

function orderChanged(before: readonly VersionModule[], after: readonly VersionModule[]): boolean {
  const a = [...before].sort((x, y) => x.position - y.position).map((m) => m.key);
  const b = [...after].sort((x, y) => x.position - y.position).map((m) => m.key);
  if (a.length !== b.length) return true;
  return a.some((key, i) => key !== b[i]);
}

function list(keys: readonly string[]): string {
  if (keys.length === 1) return keys[0]!;
  if (keys.length === 2) return `${keys[0]} and ${keys[1]}`;
  return `${keys.length} sections`;
}

/** The label stored with a version. Short enough for a list row. */
export function versionLabel(changes: readonly VersionChange[]): string {
  if (changes.length === 0) return "No visible change";
  if (changes.length === 1) return changes[0]!.text;
  return `${changes[0]!.text} · +${changes.length - 1} more`;
}

/**
 * Should this save become a version at all?
 *
 * A snapshot identical to the newest one is not history, it is noise — and a
 * list full of "No visible change" makes the real entries impossible to find.
 * Saving the same layout twice records nothing.
 */
export function isWorthVersioning(previous: ProfileSnapshot | null, next: ProfileSnapshot): boolean {
  if (!previous) return true;
  return diffSnapshots(previous, next).length > 0;
}

/** Normalise anything stored to a snapshot, tolerating an older shape. */
export function readSnapshot(raw: unknown): ProfileSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.type !== "string") return null;
  const modules = Array.isArray(o.modules)
    ? o.modules
        .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
        .map((m) => ({
          key: typeof m.key === "string" ? m.key : "",
          enabled: m.enabled !== false,
          position: typeof m.position === "number" ? m.position : 0,
          audience: typeof m.audience === "string" ? m.audience : "public",
        }))
        .filter((m) => m.key)
    : [];
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    type: o.type,
    landing: str(o.landing),
    modules,
    theme: str(o.theme),
    surface: str(o.surface),
    radius: str(o.radius),
    fontScale: str(o.fontScale),
  };
}
