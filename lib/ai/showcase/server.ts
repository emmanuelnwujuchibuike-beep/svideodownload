import "server-only";

import { unstable_cache } from "next/cache";

import { DEFAULT_SHOWCASE, SHOWCASE_LIMITS, normalizeShowcase, visibleSlides, type ShowcaseSlide } from "@/lib/ai/showcase/slides";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The showcase slides, read from `settings` (key `ai_showcase`).
 *
 * ── 🔴 ZERO REQUESTS FROM A VISITOR, AND NO CLOCK ───────────────────────────
 *
 * The slides are baked into the HTML. `/ai` is ISR, so they are read when the
 * page is rendered and never again until it is. `/studio/ai` is dynamic (it
 * reads the session), so it would otherwise read the row on EVERY entry — the
 * data cache below makes that a cache hit instead of a Supabase round trip.
 *
 * Freshness is an EVENT: the admin save calls `revalidateTag(SHOWCASE_TAG)` and
 * `revalidatePath` for both doors (app/api/admin/ai/showcase/route.ts). The
 * `revalidate: false` means there is no timer at all — nothing re-reads this
 * while nobody is saving (hard-law-never-ship-idle-consumption-2026-10-04).
 *
 * Fails OPEN to the defaults: a missing table, a network error or no Supabase
 * at all still renders a working carousel (AGENTS.md rule 4).
 */

export const SHOWCASE_TAG = "ai-showcase";
const SETTINGS_KEY = "ai_showcase";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Stored slides, every one (enabled or not); `null` when never saved. Uncached — the admin editor's read. */
export async function readStoredShowcase(): Promise<ShowcaseSlide[] | null> {
  if (!hasSupabase) return null;
  try {
    const db = createAdminClient();
    const { data, error } = await db.from("settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
    if (error || !data) return null;
    const value = data.value as { slides?: unknown } | null;
    if (!value || !Array.isArray(value.slides)) return null;
    return normalizeShowcase(value.slides, process.env.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    return null;
  }
}

export async function writeStoredShowcase(slides: ShowcaseSlide[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasSupabase) return { ok: false, error: "Storage is not configured." };
  const db = createAdminClient();
  const { error } = await db
    .from("settings")
    .upsert({ key: SETTINGS_KEY, value: { slides } }, { onConflict: "key" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * What the welcome page renders. Cached until an admin saves.
 *
 * 🔴 THE KEY CARRIES THE CODE'S OWN INPUTS. The data cache outlives a build —
 * locally in .next/cache and on Vercel across deployments — so with a fixed
 * key, a deploy that changes the starter slides or the length limits kept
 * serving the OLD list until an admin happened to press Save. Measured
 * 2026-10-05: the 320 px card still showed the pre-fix description after a
 * rebuild. The defaults and the limits are part of the key now, so changing
 * either in code is, by construction, a new cache entry.
 */
export const getShowcaseSlides = unstable_cache(
  async (): Promise<ShowcaseSlide[]> => visibleSlides(await readStoredShowcase()),
  ["ai-showcase-slides", JSON.stringify(DEFAULT_SHOWCASE), JSON.stringify(SHOWCASE_LIMITS)],
  { tags: [SHOWCASE_TAG], revalidate: false },
);
