/**
 * Content-calendar vocabulary — the PURE half (Feature 15 · Part 9).
 *
 * 🔴 CLIENT-SAFE. No Supabase, no `server-only`, no I/O.
 *
 * This file exists because of a mistake Part 8 made and this Part's own design
 * doc promised not to repeat: `lib/social/orbits.ts` held a catalogue AND a
 * server-only fetcher, and a client component importing only its TYPES still
 * dragged `server-only` into the browser bundle. `next build` failed;
 * `tsc --noEmit` said nothing.
 *
 * It happened here anyway — `calendar-board.tsx` is `"use client"` and imports
 * `PLAN_KINDS` and `PLAN_KIND_LABEL`, which lived in `plan.ts` next to the
 * Supabase reads. So the split is real this time: everything a client component
 * can need lives here, and `plan.ts` re-exports it while adding the data layer.
 *
 * The rule, generalised: a module that a `"use client"` file imports from must
 * not be the same module that touches the database — not even for types.
 */

export const PLAN_KINDS = ["idea", "campaign", "event", "launch", "collab", "seasonal"] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

export const PLAN_KIND_LABEL: Record<PlanKind, string> = {
  idea: "Idea",
  campaign: "Campaign",
  event: "Community event",
  launch: "Launch",
  collab: "Collaboration",
  seasonal: "Seasonal",
};

export type PlanStatus = "planned" | "done" | "cancelled";

export interface PlanEntry {
  id: string;
  title: string;
  note: string | null;
  kind: PlanKind;
  plannedFor: string;
  status: PlanStatus;
  createdAt: string;
}

/** A post with a publish time — the calendar's other real row type. */
export interface ScheduledPost {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  scheduledAt: string | null;
}

export function isPlanKind(v: unknown): v is PlanKind {
  return typeof v === "string" && (PLAN_KINDS as readonly string[]).includes(v);
}
