import { createAdminClient } from "@/lib/supabase/admin";

import { isCategory, type Category } from "./categories";

/**
 * FrenzDNA™ (Feature 15 Part 8) — a private, per-category interest profile
 * derived ONLY from the viewer's own real engagement (their likes/saves, and
 * how much of a post they actually watched — see post_watch_events, migration
 * 0133). Never from what other people like, never inferred demographics,
 * nothing bought or fabricated — this project has declined invented stats
 * three times (see docs/PROJECT_NOTES.md), and a fake interest graph would be
 * exactly that, just framed as personalization instead of a stat.
 *
 * Persisted to `user_interest_profile` (RLS: owner-select-only) so the
 * viewer's own Discovery Controls page can show it without recomputing on
 * every visit, refreshed at most every CACHE_TTL_MS. Recomputing is a handful
 * of indexed queries over the viewer's OWN rows — cheap enough to run inline,
 * no dedicated cron needed at this app's scale.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface InterestWeight {
  category: Category;
  /** 0-100, relative to the viewer's OWN strongest interest this window — not
   *  comparable across viewers, and never displayed as if it were. */
  weight: number;
}

const WINDOW_DAYS = 60;
const CACHE_TTL_MS = 5 * 60_000;
const TOP_N = 8;

export async function getFrenzDna(userId: string | null): Promise<InterestWeight[]> {
  if (!hasSupabase || !userId) return [];
  try {
    const db = createAdminClient();
    const { data: existing } = await db
      .from("user_interest_profile")
      .select("category, weight, updated_at")
      .eq("user_id", userId)
      .order("weight", { ascending: false });
    const rows = (existing ?? []) as { category: string; weight: number; updated_at: string }[];
    const freshest = rows[0]?.updated_at ? new Date(rows[0].updated_at).getTime() : 0;
    if (rows.length > 0 && Date.now() - freshest < CACHE_TTL_MS) {
      return rows.filter((r) => isCategory(r.category)).map((r) => ({ category: r.category as Category, weight: r.weight }));
    }
  } catch {
    /* user_interest_profile not migrated yet — fall through to a live compute */
  }

  const computed = await computeInterestWeights(userId);
  void persistInterestWeights(userId, computed);
  return computed;
}

async function computeInterestWeights(userId: string): Promise<InterestWeight[]> {
  if (!hasSupabase) return [];
  try {
    const db = createAdminClient();
    const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();

    const [{ data: reactionRows }, watchRes] = await Promise.all([
      db.from("post_reactions").select("post_id, type").eq("user_id", userId).gte("created_at", since).limit(500),
      db
        .from("post_watch_events")
        .select("post_id, watch_ms, duration_ms")
        .eq("viewer_id", userId)
        .gte("created_at", since)
        .limit(500),
    ]);

    const reactions = (reactionRows ?? []) as { post_id: string; type: string }[];
    const watches = (watchRes.data ?? []) as { post_id: string; watch_ms: number; duration_ms: number }[];
    const postIds = [...new Set([...reactions.map((r) => r.post_id), ...watches.map((w) => w.post_id)])];
    if (postIds.length === 0) return [];

    const { data: postRows } = await db.from("posts").select("id, category").in("id", postIds);
    const categoryById = new Map(((postRows ?? []) as { id: string; category: string | null }[]).map((p) => [p.id, p.category]));

    const raw = new Map<Category, number>();
    const bump = (cat: string | null | undefined, amount: number) => {
      if (!cat || !isCategory(cat)) return;
      raw.set(cat, (raw.get(cat) ?? 0) + amount);
    };
    // Saves outweigh likes (a deliberate, bookmark-worthy signal beats a
    // passive tap) — the same relative weighting `smart-feed.ts`'s
    // `engagementScore` already gives saves over likes elsewhere.
    for (const r of reactions) bump(categoryById.get(r.post_id), r.type === "save" ? 3 : 2);
    for (const w of watches) {
      const completion = w.duration_ms > 0 ? Math.min(1, w.watch_ms / w.duration_ms) : 0;
      bump(categoryById.get(w.post_id), completion * 2);
    }
    if (raw.size === 0) return [];

    const max = Math.max(...raw.values());
    return [...raw.entries()]
      .map(([category, score]) => ({ category, weight: Math.round((score / max) * 100) }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, TOP_N);
  } catch {
    return [];
  }
}

async function persistInterestWeights(userId: string, weights: InterestWeight[]): Promise<void> {
  if (!hasSupabase) return;
  try {
    const db = createAdminClient();
    await db.from("user_interest_profile").delete().eq("user_id", userId);
    if (weights.length === 0) return;
    await db.from("user_interest_profile").insert(
      weights.map((w) => ({ user_id: userId, category: w.category, weight: w.weight, updated_at: new Date().toISOString() })),
    );
  } catch {
    /* best-effort persistence — the caller already has the computed value */
  }
}

/**
 * Discovery Controls "Reset personalization". Clears the persisted interest
 * profile only — boosted/muted categories and the Home layout are their OWN
 * independently-reset preferences (see HomeModulesEditor's `reset`, and
 * /api/home-preferences), the same separation already established there.
 */
export async function resetFrenzDna(userId: string): Promise<void> {
  if (!hasSupabase) return;
  try {
    await createAdminClient().from("user_interest_profile").delete().eq("user_id", userId);
  } catch {
    /* table not migrated yet — nothing to clear */
  }
}
