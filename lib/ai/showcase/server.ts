import "server-only";

import { unstable_cache } from "next/cache";

import { normalizeShowcaseCards, type ShowcaseCards } from "@/lib/ai/showcase/cards";
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

/** Stored tool-card media (lib/ai/showcase/cards.ts); `{}` when none. Uncached — the admin editor's read. */
export async function readStoredShowcaseCards(): Promise<ShowcaseCards> {
  if (!hasSupabase) return {};
  try {
    const db = createAdminClient();
    const { data, error } = await db.from("settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
    if (error || !data) return {};
    return normalizeShowcaseCards((data.value as { cards?: unknown } | null)?.cards, process.env.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    return {};
  }
}

/**
 * Save the slides, the cards, or both. 🔴 The two share ONE row: whichever is
 * not being saved is read back and kept — saving the slides must never wipe
 * the cards (or the reverse).
 */
export async function writeStoredShowcase(next: { slides?: ShowcaseSlide[]; cards?: ShowcaseCards }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasSupabase) return { ok: false, error: "Storage is not configured." };
  const db = createAdminClient();
  const { data, error: readError } = await db.from("settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  const current = (data?.value as { slides?: unknown; cards?: unknown } | null) ?? {};
  const value = {
    slides: next.slides ?? (Array.isArray(current.slides) ? current.slides : []),
    cards: next.cards ?? normalizeShowcaseCards(current.cards, process.env.NEXT_PUBLIC_SUPABASE_URL),
  };
  // a row never saved before keeps the default carousel until slides are saved
  if (!next.slides && !Array.isArray(current.slides)) delete (value as { slides?: unknown }).slides;
  const { error } = await db.from("settings").upsert({ key: SETTINGS_KEY, value }, { onConflict: "key" });
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

/** The hub's tool-card media. Same cache and tag as the slides: refreshed only by an admin save. */
export const getShowcaseCards = unstable_cache(async (): Promise<ShowcaseCards> => readStoredShowcaseCards(), ["ai-showcase-cards"], {
  tags: [SHOWCASE_TAG],
  revalidate: false,
});
