import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import { isPlanKind, type PlanEntry, type PlanKind, type PlanStatus, type ScheduledPost } from "./plan-kinds";

/**
 * Content calendar (Feature 15 · Part 9).
 *
 * The calendar draws TWO real row types and invents no third:
 *
 *   · Scheduled posts — `posts.scheduled_at` (migration 0140). Real content
 *     with a real publish time.
 *   · Plans — `content_plan` rows. Ideas, campaigns, community events, launches
 *     and collaborations that are not yet content.
 *
 * A plan is deliberately not a post. It has no media, no source URL and no
 * publisher semantics, and a `posts` row that is none of those things would sit
 * behind every feed query in the product relying on all of them to filter it
 * back out. Two shapes, two tables, no ambiguity about what is publishable.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/*
  The vocabulary lives in ./plan-kinds — a pure, client-safe module — and is
  re-exported here so every existing server-side import keeps working. The
  calendar board is a client component and imports it DIRECTLY from there;
  importing it from this file would pull "server-only" into the browser bundle,
  which is exactly how this Part's build broke once already.
*/
export {
  PLAN_KINDS,
  PLAN_KIND_LABEL,
  isPlanKind,
  type PlanKind,
  type PlanStatus,
  type PlanEntry,
  type ScheduledPost,
} from "./plan-kinds";

interface PlanRow {
  id: string;
  title: string;
  note: string | null;
  kind: string;
  planned_for: string;
  status: string;
  created_at: string;
}

const toEntry = (r: PlanRow): PlanEntry => ({
  id: r.id,
  title: r.title,
  note: r.note,
  kind: (r.kind as PlanKind) ?? "idea",
  plannedFor: r.planned_for,
  status: (r.status as PlanStatus) ?? "planned",
  createdAt: r.created_at,
});

/** Plans inside a date window, inclusive of both ends (ISO `YYYY-MM-DD`). */
export async function listPlans(userId: string, from: string, to: string): Promise<PlanEntry[]> {
  if (!hasSupabase) return [];
  try {
    const { data } = await createAdminClient()
      .from("content_plan")
      .select("id, title, note, kind, planned_for, status, created_at")
      .eq("user_id", userId)
      .gte("planned_for", from)
      .lte("planned_for", to)
      .order("planned_for", { ascending: true })
      .limit(500);
    return ((data ?? []) as PlanRow[]).map(toEntry);
  } catch {
    // Pre-migration, or a transient failure: an empty calendar is a working
    // calendar. It must not take the page down.
    return [];
  }
}

export interface CreatePlanInput {
  title: string;
  note?: string | null;
  kind: PlanKind;
  plannedFor: string;
}

export async function createPlan(userId: string, input: CreatePlanInput): Promise<PlanEntry | null> {
  if (!hasSupabase) return null;
  const title = input.title.trim().slice(0, 200);
  if (!title) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.plannedFor)) return null;

  try {
    const { data } = await createAdminClient()
      .from("content_plan")
      .insert({
        user_id: userId,
        title,
        note: input.note ? input.note.trim().slice(0, 2000) : null,
        kind: isPlanKind(input.kind) ? input.kind : "idea",
        planned_for: input.plannedFor,
      })
      .select("id, title, note, kind, planned_for, status, created_at")
      .maybeSingle();
    return data ? toEntry(data as PlanRow) : null;
  } catch {
    return null;
  }
}

export interface UpdatePlanInput {
  title?: string;
  note?: string | null;
  kind?: PlanKind;
  plannedFor?: string;
  status?: PlanStatus;
}

export async function updatePlan(id: string, userId: string, patch: UpdatePlanInput): Promise<boolean> {
  if (!hasSupabase) return false;
  const row: Record<string, unknown> = {};
  if (typeof patch.title === "string") {
    const t = patch.title.trim().slice(0, 200);
    if (!t) return false;
    row.title = t;
  }
  if (patch.note !== undefined) row.note = patch.note === null ? null : patch.note.trim().slice(0, 2000);
  if (patch.kind !== undefined && isPlanKind(patch.kind)) row.kind = patch.kind;
  if (patch.plannedFor !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.plannedFor)) return false;
    row.planned_for = patch.plannedFor;
  }
  if (patch.status !== undefined && ["planned", "done", "cancelled"].includes(patch.status)) {
    row.status = patch.status;
  }
  if (Object.keys(row).length === 0) return false;

  try {
    // Ownership is matched explicitly: the service role bypasses RLS, so the
    // policy is the backstop here, never the gate.
    const { error } = await createAdminClient().from("content_plan").update(row).eq("id", id).eq("user_id", userId);
    return !error;
  } catch {
    return false;
  }
}

export async function deletePlan(id: string, userId: string): Promise<boolean> {
  if (!hasSupabase) return false;
  try {
    const { error } = await createAdminClient().from("content_plan").delete().eq("id", id).eq("user_id", userId);
    return !error;
  } catch {
    return false;
  }
}

/** Scheduled posts in a window. A dateless draft (`scheduled_at` null) is
 *  deliberately excluded — it has no day to sit on — and the content manager
 *  is where those live. */
export async function listScheduledPosts(userId: string, from: string, to: string): Promise<ScheduledPost[]> {
  if (!hasSupabase) return [];
  try {
    const { data } = await createAdminClient()
      .from("posts")
      .select("id, title, thumbnail_url, scheduled_at")
      .eq("publisher_id", userId)
      .eq("status", "scheduled")
      .not("scheduled_at", "is", null)
      .gte("scheduled_at", `${from}T00:00:00.000Z`)
      .lte("scheduled_at", `${to}T23:59:59.999Z`)
      .order("scheduled_at", { ascending: true })
      .limit(500);

    return ((data ?? []) as { id: string; title: string; thumbnail_url: string | null; scheduled_at: string | null }[]).map(
      (r) => ({ id: r.id, title: r.title, thumbnailUrl: r.thumbnail_url, scheduledAt: r.scheduled_at }),
    );
  } catch {
    return [];
  }
}

/** Posts published in a window — the calendar's "what actually went out". */
export async function listPublishedInWindow(userId: string, from: string, to: string): Promise<ScheduledPost[]> {
  if (!hasSupabase) return [];
  try {
    const { data } = await createAdminClient()
      .from("posts")
      .select("id, title, thumbnail_url, created_at")
      .eq("publisher_id", userId)
      .eq("status", "published")
      .gte("created_at", `${from}T00:00:00.000Z`)
      .lte("created_at", `${to}T23:59:59.999Z`)
      .order("created_at", { ascending: true })
      .limit(500);

    return ((data ?? []) as { id: string; title: string; thumbnail_url: string | null; created_at: string }[]).map(
      (r) => ({ id: r.id, title: r.title, thumbnailUrl: r.thumbnail_url, scheduledAt: r.created_at }),
    );
  } catch {
    return [];
  }
}
