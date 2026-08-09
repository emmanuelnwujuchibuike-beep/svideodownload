import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The wallpaper shown BEHIND the "Wallpaper Gallery" button (owner, 2026-08-09:
 * "a background image that shows the texts and icon clearly and also a wallpaper
 * set by the admin in admin dashboard").
 *
 * ── Why the generic `settings` table and not a new column ────────────────────
 * `settings` (migration 0001) is a key/value jsonb store already used for the
 * analytics CPM and the Monetag switches. One row here means **no migration** —
 * which matters right now specifically because nine were pending until today,
 * and adding a tenth to a stack nobody has run makes the stack less likely to be
 * run. A `is_cta_background` column on `wallpapers` would also have to be
 * mutually exclusive across rows, which is a constraint the app would have to
 * enforce on every write; one setting row is exclusive by construction.
 *
 * ── Why this never un-statics the landing page ──────────────────────────────
 * This is a plain database read with no request-scoped input — no `cookies()`,
 * no `headers()`, no `searchParams`. Next prerenders `/` and revalidates it on
 * the route's own interval (currently 1 minute), exactly as the marketing
 * layout's reels warm-up read already does. A change in the admin panel appears
 * within that window without the page ever becoming dynamic.
 *
 * 🔴 If this is ever called from a client component or given request data, `/`
 * silently loses its CDN caching — the defect that once cost the front door a
 * 799–4752 ms TTFB. It is server-only on purpose.
 */

const SETTINGS_KEY = "wallpaper_cta";

export interface CtaWallpaper {
  /** Full-size image URL, or null when the admin has not chosen one. */
  url: string | null;
  /** The wallpaper's name — used for the admin panel's current-selection label. */
  name: string | null;
  id: string | null;
}

const NONE: CtaWallpaper = { url: null, name: null, id: null };

/**
 * The admin's chosen background, or nulls.
 *
 * Never throws. A failure here must degrade to the plain gradient button rather
 * than break the landing page — the button is the feature, the photo behind it
 * is decoration.
 */
export async function getCtaWallpaper(): Promise<CtaWallpaper> {
  try {
    const db = createAdminClient();
    const { data: setting } = await db
      .from("settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();

    const id = (setting?.value as { wallpaperId?: unknown } | null)?.wallpaperId;
    if (typeof id !== "string" || id.length === 0) return NONE;

    /*
      Resolved through the wallpapers table on every read rather than storing the
      URL in the setting.

      A stored URL goes stale the moment the wallpaper is re-uploaded or removed,
      and the button would then point at a dead image with nothing to notice it.
      Reading by id means a deleted wallpaper degrades to the gradient, which is
      the correct answer rather than a broken one.
    */
    const { data: row } = await db
      .from("wallpapers")
      .select("id, title, image_url, thumb_url, status")
      .eq("id", id)
      .maybeSingle();

    if (!row || row.status !== "published") return NONE;

    /*
      The THUMB, when there is one.

      This is a decorative background at roughly 340×176 CSS pixels, never a
      wallpaper anyone is looking at full-size. Serving the original would push
      megabytes onto the landing page for a texture — and the last audit found a
      single component pulling 13.1 MB of the landing's 14.5 MB payload exactly
      that way.
    */
    const url = (row.thumb_url as string | null) || (row.image_url as string | null);
    if (!url) return NONE;

    return { url, name: (row.title as string | null) ?? null, id: row.id as string };
  } catch {
    return NONE;
  }
}

/** Admin: choose the wallpaper, or pass null to go back to the plain gradient. */
export async function setCtaWallpaper(wallpaperId: string | null): Promise<void> {
  const db = createAdminClient();
  await db
    .from("settings")
    .upsert({ key: SETTINGS_KEY, value: { wallpaperId } }, { onConflict: "key" });
}
