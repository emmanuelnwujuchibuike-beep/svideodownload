/**
 * Feature-flag registry — the single source of truth for every runtime toggle in
 * the Frenzsave ecosystem. This is the Config/Feature-Flag service named in the
 * Engineering Constitution's Gap Ledger (docs/CONSTITUTION.md, Article VI).
 *
 * ── Why a static registry (like `lib/platform/modules.ts`) ────────────────────
 *
 * Flags are DECLARED here in code, in one plain array. The *state* of a flag (a
 * kill switch, a rollout percentage) is an admin-editable override that lives in
 * the database; the flag's identity, meaning, default and targeting live here so
 * they are typed, reviewable in a PR, and impossible to typo at a call site. A
 * flag that isn't declared here cannot be referenced — the same discipline the
 * module registry uses to keep nav/RBAC/search from drifting.
 *
 * ── Dependency-light on purpose ───────────────────────────────────────────────
 *
 * This file is types + pure functions only (it imports one TYPE). The database
 * read lives in `./flags-store` (server-only). So `resolveFlag` can be unit-tested
 * with no I/O, and a Client Component can hold a resolved boolean handed down from
 * the server without pulling the store — or the Supabase client — into its bundle.
 * Per the Constitution's load-time guarantee: a flag that is OFF costs 0 client JS.
 */
import type { BillingPlan } from "@/lib/monetization/types";

/** The visitor a flag is being resolved for. */
export interface FlagContext {
  plan: BillingPlan;
  isAdmin: boolean;
  /**
   * Stable per-user id used to bucket percentage rollouts deterministically.
   * Anonymous visitors have none — see the anon rule in {@link resolveFlag}.
   */
  userId?: string | null;
}

/** The admin-editable half of a flag, persisted per id. All fields optional. */
export interface FlagOverride {
  /**
   * Manual switch. `true` forces ON, `false` forces OFF (a kill switch), and
   * `null`/absent defers to the rollout + default. An explicit value always wins
   * over a percentage rollout — that is the whole point of a kill switch.
   */
  enabled?: boolean | null;
  /** 0–100. Overrides the flag's declared `rollout`. `null`/absent = no override. */
  rolloutPercentage?: number | null;
}

export type FlagCategory = "product" | "experiment" | "ops" | "kill-switch";

export interface FeatureFlag {
  /** Stable, unique, kebab-case id. Never reuse or rename. e.g. "smart-assistant-widget". */
  id: string;
  /** Human label for the admin panel. */
  label: string;
  /** One line: what turning this on does, and what OFF means. */
  description: string;
  category: FlagCategory;
  /**
   * Default when there is no override and no `rollout`. Expressed as a percentage
   * internally: `true` ⇒ 100%, `false` ⇒ 0%. Keeping OFF as the default for a new
   * flag means shipping the flag is behaviour-preserving until someone ramps it.
   */
  defaultEnabled: boolean;
  /**
   * Optional declared rollout percentage (0–100). When set, it replaces
   * `defaultEnabled` as the baseline and gates ON by deterministic per-user
   * bucketing. An admin override still takes precedence.
   */
  rollout?: number;
  /**
   * Optional entitlement gate. When present, the flag can only be ON for these
   * plans — a hard AND applied before everything else, so a "business" flag is
   * never on for a free user even at 100% rollout or a forced-on override.
   */
  plans?: BillingPlan[];
  /**
   * If true, an admin always resolves ON (except when the plan gate excludes them),
   * so operators can preview a flag before ramping it. Does not affect other users.
   */
  adminBypass?: boolean;
  /** Where this flag is read. Free text for humans; "pending" until wired. */
  consumer: string;
}

/* --------------------------------- registry -------------------------------- */

export const FLAGS: FeatureFlag[] = [
  {
    id: "smart-assistant-widget",
    label: "Smart assistant widget",
    description:
      "Mounts the floating assistant. OFF today (the widget is unmounted in app/layout.tsx), so this ships behavior-preserving; flip it to preview the re-mount.",
    category: "product",
    defaultEnabled: false,
    adminBypass: true,
    // Honest: the consumer re-mount is a follow-up. The flag + admin control +
    // resolver are real now; wiring layout.tsx to read it is the next step and is
    // intentionally NOT bundled here (it touches the root layout / 2s budget).
    consumer: "pending — app/layout.tsx assistant mount",
  },
];

/* --------------------------------- resolve --------------------------------- */

/**
 * Deterministic 0–99 bucket for `(flagId, userId)`. Pure, dependency-free
 * (FNV-1a, not crypto — this is bucketing, not security). The same user lands in
 * the same bucket for a given flag on every instance and every request, so a 20%
 * rollout is a stable 20% of users, not a fresh dice roll each page load.
 */
export function bucketOf(flagId: string, userId: string): number {
  let h = 0x811c9dc5;
  const key = `${flagId}:${userId}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    // h * 16777619, kept in 32-bit space without overflow via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 100;
}

/**
 * Resolve a flag to a boolean. Pure — no I/O — so it is exhaustively testable.
 *
 * Resolution order (first decisive rule wins):
 *   1. Plan gate      — if `flag.plans` excludes the context plan ⇒ OFF (hard AND).
 *   2. Admin preview  — if `flag.adminBypass` and the context is an admin ⇒ ON.
 *   3. Manual override — `override.enabled === true|false` ⇒ ON|OFF (kill switch).
 *   4. Rollout        — effective % (override ?? flag.rollout ?? default→0/100):
 *                       ≤0 ⇒ OFF, ≥100 ⇒ ON, else bucket(userId) < %.
 *                       An anonymous visitor (no userId) can't be bucketed, so a
 *                       partial rollout resolves OFF for them — conservative on
 *                       purpose; use a 100% or plan-gated flag for anon surfaces.
 */
export function resolveFlag(
  flag: FeatureFlag,
  override: FlagOverride | undefined,
  ctx: FlagContext,
): boolean {
  // 1. Entitlement gate — hardest rule, not previewable.
  if (flag.plans && !flag.plans.includes(ctx.plan)) return false;

  // 2. Admin preview.
  if (flag.adminBypass && ctx.isAdmin) return true;

  // 3. Manual override (kill switch / force-on).
  if (override?.enabled === true) return true;
  if (override?.enabled === false) return false;

  // 4. Percentage rollout.
  const pct =
    override?.rolloutPercentage ??
    flag.rollout ??
    (flag.defaultEnabled ? 100 : 0);
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  if (!ctx.userId) return false;
  return bucketOf(flag.id, ctx.userId) < pct;
}

/* --------------------------------- queries --------------------------------- */

/** All declared flags, in declaration order. */
export function getFlags(): FeatureFlag[] {
  return FLAGS;
}

/** A flag by its stable id, or undefined. */
export function getFlag(id: string): FeatureFlag | undefined {
  return FLAGS.find((f) => f.id === id);
}

/** Default context for a request with no session yet. */
export const ANON_FLAG_CONTEXT: FlagContext = { plan: "free", isAdmin: false, userId: null };
