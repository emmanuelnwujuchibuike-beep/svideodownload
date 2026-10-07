import "server-only";

import { unstable_cache } from "next/cache";

import { DEFAULT_PROMO_TIMING, EMPTY_PROMO, PROMO_TIMING_LIMITS, normalizePromo, type AiPromo } from "@/lib/ai/promo/config";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The landing promotion, read from `settings` (key `ai_promo`).
 *
 * The same contract as the showcase (lib/ai/showcase/server.ts): baked into the
 * static landing HTML, refreshed by an EVENT — the admin save calls
 * `revalidateTag(PROMO_TAG)` and `revalidatePath("/")` — never by a clock, and
 * never asked for by a visitor's browser (Brief C §19: no polling, no realtime).
 * Fails OPEN to "no media": the tile is then the intro alone, which works.
 */

export const PROMO_TAG = "ai-promo";
const SETTINGS_KEY = "ai_promo";

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Uncached — the admin editor's read. */
export async function readStoredPromo(): Promise<AiPromo | null> {
  if (!hasSupabase) return null;
  try {
    const { data, error } = await createAdminClient().from("settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
    if (error || !data) return null;
    return normalizePromo(data.value, process.env.NEXT_PUBLIC_SUPABASE_URL);
  } catch {
    return null;
  }
}

export async function writeStoredPromo(promo: AiPromo): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasSupabase) return { ok: false, error: "Storage is not configured." };
  const { error } = await createAdminClient().from("settings").upsert({ key: SETTINGS_KEY, value: promo }, { onConflict: "key" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** What the landing renders. Cached until an admin saves; the key carries the code's own defaults (see the showcase note). */
export const getAiPromo = unstable_cache(
  async (): Promise<AiPromo> => (await readStoredPromo()) ?? EMPTY_PROMO,
  ["ai-promo", JSON.stringify(DEFAULT_PROMO_TIMING), JSON.stringify(PROMO_TIMING_LIMITS)],
  { tags: [PROMO_TAG], revalidate: false },
);
