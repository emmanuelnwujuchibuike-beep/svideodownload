import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Site announcement banner — set from the ADMIN DASHBOARD, shown premium at the
 * top of the home + download pages (owner, 2026-08-03: "a premium banner at the
 * top … for announcement, version update, new features … admin can set them").
 *
 * Stored in the `settings` table under key `announcement` (same pattern as the
 * Paystack + analytics config). Read publicly (enabled-only, no secrets) by the
 * banner; written by admins. The `id` is a content hash so any edit re-shows the
 * banner to visitors who dismissed the previous one.
 */

export type AnnouncementVariant = "feature" | "update" | "announcement" | "promo";

export interface Announcement {
  enabled: boolean;
  message: string;
  ctaLabel: string | null;
  ctaHref: string | null;
  variant: AnnouncementVariant;
  dismissible: boolean;
}

export interface PublicAnnouncement extends Announcement {
  /** Content hash — the localStorage dismissal key. Changes when the copy changes. */
  id: string;
}

export const DEFAULT_ANNOUNCEMENT: Announcement = {
  enabled: false,
  message: "",
  ctaLabel: null,
  ctaHref: null,
  variant: "feature",
  dismissible: true,
};

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function isVariant(v: unknown): v is AnnouncementVariant {
  return v === "feature" || v === "update" || v === "announcement" || v === "promo";
}

/** Small stable hash so a dismissal only sticks until the copy changes. */
function contentId(a: Announcement): string {
  const s = `${a.message}|${a.ctaLabel ?? ""}|${a.ctaHref ?? ""}|${a.variant}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function normalize(raw: Partial<Announcement> | null | undefined): Announcement {
  const r = raw ?? {};
  return {
    enabled: r.enabled === true,
    message: typeof r.message === "string" ? r.message.slice(0, 300) : "",
    ctaLabel: typeof r.ctaLabel === "string" && r.ctaLabel.trim() ? r.ctaLabel.trim().slice(0, 40) : null,
    ctaHref: typeof r.ctaHref === "string" && r.ctaHref.trim() ? r.ctaHref.trim().slice(0, 500) : null,
    variant: isVariant(r.variant) ? r.variant : "feature",
    dismissible: r.dismissible !== false,
  };
}

/** The stored announcement (admin view — always returns a value, enabled or not). */
export async function getAnnouncementConfig(): Promise<Announcement> {
  if (!hasSupabase) return DEFAULT_ANNOUNCEMENT;
  try {
    const db = createAdminClient();
    const { data } = await db.from("settings").select("value").eq("key", "announcement").maybeSingle();
    return normalize(data?.value as Partial<Announcement> | null);
  } catch {
    return DEFAULT_ANNOUNCEMENT;
  }
}

/** The public announcement, or null when disabled / blank. Includes the content id. */
export async function getPublicAnnouncement(): Promise<PublicAnnouncement | null> {
  const a = await getAnnouncementConfig();
  if (!a.enabled || !a.message.trim()) return null;
  return { ...a, id: contentId(a) };
}

/** Admin: persist the announcement. */
export async function setAnnouncementConfig(patch: Partial<Announcement>): Promise<Announcement> {
  const db = createAdminClient();
  const merged = normalize(patch);
  await db.from("settings").upsert({ key: "announcement", value: merged }, { onConflict: "key" });
  return merged;
}
