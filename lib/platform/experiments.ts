/**
 * Experiment registry — declared A/B (and A/B/n) tests, and the deterministic
 * assignment that powers them. The next item after feature flags in the
 * Engineering Constitution's Gap Ledger (docs/CONSTITUTION.md, Article VI), and a
 * deliberate sibling of `lib/platform/flags.ts`: same registry discipline, same
 * pure/dependency-light split, and it reuses the flags' `bucketOf` so a user's
 * assignment is stable across instances and requests.
 *
 * ── Flags vs. experiments ─────────────────────────────────────────────────────
 *
 * A flag answers "is this ON for you?" (a boolean rollout). An experiment answers
 * "which of N variants are you in?" and is measured — every enrolled exposure is
 * logged so `control` and `treatment` can be compared. A flag ramps a finished
 * decision; an experiment makes one.
 *
 * ── Pure, so it is exhaustively testable ──────────────────────────────────────
 *
 * This file is types + pure functions. The database (runtime pause / forced
 * variant overrides, exposure counts) lives in `./experiments-store` (server
 * only). `assignVariant` does no I/O, so the assignment logic is unit-tested with
 * no Supabase in the loop.
 */
import type { BillingPlan } from "@/lib/monetization/types";

import { bucketOf, type FlagContext } from "./flags";

/** The visitor an experiment is assigned for. Same shape as a flag context. */
export type ExperimentContext = FlagContext;

/** One arm of an experiment. `weight` is relative — arms need not sum to 100. */
export interface Variant {
  id: string;
  weight: number;
}

export type ExperimentStatus = "draft" | "running" | "concluded";

/** The admin-editable, per-experiment runtime override (mirrors FlagOverride). */
export interface ExperimentOverride {
  /** Force everyone to `control` and stop enrolling, without a redeploy. */
  paused?: boolean | null;
  /** Ship a decision: force every eligible visitor into this variant. */
  forceVariant?: string | null;
}

export interface Experiment {
  /** Stable, unique, kebab-case id. Never reuse or rename. */
  id: string;
  label: string;
  description: string;
  /**
   * `draft` and `concluded` do not enroll — everyone resolves to `control` and
   * nothing is logged, so a draft is a zero-impact template and a concluded test
   * is frozen. Only `running` assigns.
   */
  status: ExperimentStatus;
  /**
   * Arms. **The first arm is the control by convention** (returned whenever a
   * visitor is not enrolled), so order matters — like the module registry.
   */
  variants: Variant[];
  /** Optional entitlement gate: only these plans are eligible to enroll. */
  plans?: BillingPlan[];
}

/* --------------------------------- registry -------------------------------- */

export const EXPERIMENTS: Experiment[] = [
  {
    /*
      A DRAFT template, not a live test. `status: "draft"` ⇒ never enrolls, assigns
      everyone to control, logs nothing — zero product impact. It exists so the
      admin panel has a concrete row to show and so the shape of a real experiment
      is one copy-paste away. To launch a real one: add a variant-reading consumer
      (see `getAssignment` in ./experiments-store), then flip status to "running".
    */
    id: "example-cta-copy",
    label: "Example — CTA copy (draft template)",
    description:
      "Template only. Draft, so it assigns everyone to control and records nothing. Duplicate it, wire a consumer, and set status to running to launch a real test.",
    status: "draft",
    variants: [
      { id: "control", weight: 50 },
      { id: "treatment", weight: 50 },
    ],
  },
];

/* -------------------------------- assignment ------------------------------- */

/** The control arm — the first declared variant. */
export function controlOf(exp: Experiment): string {
  return exp.variants[0]?.id ?? "control";
}

/** Pick a variant id for a 0–99 bucket, proportional to weights. Pure. */
function weightedPick(exp: Experiment, bucket: number): string {
  const total = exp.variants.reduce((s, v) => s + Math.max(0, v.weight), 0);
  if (total <= 0) return controlOf(exp);
  let acc = 0;
  for (const v of exp.variants) {
    acc += Math.max(0, v.weight);
    if (bucket < (acc / total) * 100) return v.id;
  }
  return exp.variants[exp.variants.length - 1]!.id;
}

export interface Assignment {
  variant: string;
  /**
   * True only when the visitor is genuinely part of a running experiment's
   * population. A non-enrolled visitor still gets a `variant` (control) so
   * rendering is unconditional — but callers must log an exposure ONLY when
   * `enrolled`, or the measurement is polluted with people who never varied.
   */
  enrolled: boolean;
}

/**
 * Assign a visitor to a variant. Pure — no I/O.
 *
 * Order (first decisive rule wins):
 *   1. Not running (draft/concluded) or `override.paused` ⇒ control, not enrolled.
 *   2. Plan gate excludes ⇒ control, not enrolled.
 *   3. `override.forceVariant` (and it's a real arm) ⇒ that arm, enrolled.
 *   4. Anonymous (no userId — can't bucket) ⇒ control, not enrolled.
 *   5. Deterministic weighted bucket ⇒ that arm, enrolled.
 *
 * Bucketing is namespaced `experiment:<id>` so a visitor's assignment is
 * independent of any feature flag that happens to share an id.
 */
export function assignVariant(
  exp: Experiment,
  ctx: ExperimentContext,
  override?: ExperimentOverride,
): Assignment {
  const control = controlOf(exp);

  if (exp.status !== "running" || override?.paused === true) {
    return { variant: control, enrolled: false };
  }
  if (exp.plans && !exp.plans.includes(ctx.plan)) {
    return { variant: control, enrolled: false };
  }
  if (override?.forceVariant && exp.variants.some((v) => v.id === override.forceVariant)) {
    return { variant: override.forceVariant, enrolled: true };
  }
  if (!ctx.userId) {
    return { variant: control, enrolled: false };
  }
  return { variant: weightedPick(exp, bucketOf(`experiment:${exp.id}`, ctx.userId)), enrolled: true };
}

/* --------------------------------- queries --------------------------------- */

/** All declared experiments, in declaration order. */
export function getExperiments(): Experiment[] {
  return EXPERIMENTS;
}

/** An experiment by its stable id, or undefined. */
export function getExperiment(id: string): Experiment | undefined {
  return EXPERIMENTS.find((e) => e.id === id);
}
