import "server-only";

import { sendSmartPush } from "@/lib/notifications/smart-delivery";
import type { NotificationType } from "@/lib/platform/notifications-registry";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "SOMEONE LIKED YOUR WALLPAPER" — one sender for all three actions
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-04: "Let users who uploaded a wallpaper get notified when
 * someone liked, saved, or downloaded their wallpaper."
 *
 * `wallpapers.uploaded_by` has been recorded since 0105 and read by nothing. A
 * member who shares a wallpaper to the public library has had no way of knowing
 * anybody ever saw it.
 *
 * ── 🔴 THE FOUR RULES THIS FUNCTION EXISTS TO HOLD IN ONE PLACE ────────────
 *
 *  1. NEVER NOTIFY YOURSELF. Liking or downloading your own wallpaper is the
 *     most common way these fire during testing, and "you liked your wallpaper"
 *     is how a member learns the notifications are noise.
 *  2. ONLY MEMBER UPLOADS. A curated admin wallpaper has no `uploaded_by`, or
 *     has one belonging to an operator who did not "share" anything — there is
 *     nobody whose work this is.
 *  3. NEVER BLOCK, NEVER THROW. The caller is a like, a save or a download. A
 *     notification failing must not fail the thing the member actually did, so
 *     every path here resolves and errors are swallowed deliberately.
 *  4. `low` PRIORITY, SOCIAL CATEGORY. This is the lock-screen tier for other
 *     people's activity on your things, so Do Not Disturb, quiet hours, the
 *     frequency cap and the category toggles all govern it — exactly as they
 *     govern a like on a post. The in-app record is written regardless, because
 *     `sendSmartPush` records before it suppresses.
 *
 * ── Anonymous downloads ────────────────────────────────────────────────────
 *
 * A download can come from a signed-out visitor, so `actorId` is nullable here
 * where it would not be for a like. The copy says "Someone" rather than naming
 * a member we do not have — and that is the honest sentence, not a fallback.
 */

export type WallpaperEngagement = "like" | "save" | "download";

const COPY: Record<WallpaperEngagement, { type: NotificationType; verb: string; emoji: string }> = {
  like: { type: "wallpaper_like", verb: "liked", emoji: "❤️" },
  save: { type: "wallpaper_save", verb: "saved", emoji: "🔖" },
  download: { type: "wallpaper_download", verb: "downloaded", emoji: "⬇️" },
};

/**
 * Tell a wallpaper's uploader that someone engaged with it.
 *
 * Fire-and-forget by design — `void` it, or `await` it inside an `after()`.
 * Resolves even when nothing was sent.
 */
export async function notifyWallpaperEngagement(opts: {
  wallpaperId: string;
  action: WallpaperEngagement;
  /** The member who did it, or null for a signed-out download. */
  actorId: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: wallpaper } = await admin
      .from("wallpapers")
      .select("id, title, uploaded_by, source")
      .eq("id", opts.wallpaperId)
      .maybeSingle();

    const uploaderId = wallpaper?.uploaded_by as string | null | undefined;
    // Rule 2, then rule 1 — in that order, because a curated wallpaper has no
    // owner to compare the actor against in the first place.
    if (!uploaderId || wallpaper?.source !== "member") return;
    if (opts.actorId && opts.actorId === uploaderId) return;

    const copy = COPY[opts.action];
    const title = (wallpaper?.title as string | null) || "your wallpaper";

    let who = "Someone";
    if (opts.actorId) {
      const { data: actor } = await admin.from("profiles").select("handle, display_name").eq("id", opts.actorId).maybeSingle();
      const handle = (actor?.handle as string | null) || null;
      const name = (actor?.display_name as string | null) || null;
      who = handle ? `@${handle}` : name || "Someone";
    }

    await sendSmartPush(
      uploaderId,
      {
        title: `${copy.emoji} ${who} ${copy.verb} your wallpaper`,
        body: title,
        url: `/wallpapers?w=${encodeURIComponent(opts.wallpaperId)}`,
        /*
          One tag per wallpaper per action, so a wallpaper collecting likes
          REPLACES its own lock-screen notification instead of stacking twenty.
          The Notification Center still keeps every row — this governs the lock
          screen only.
        */
        tag: `wallpaper-${opts.action}-${opts.wallpaperId}`,
        genericBody: "New activity on your wallpaper",
      },
      "low",
      "social",
      { type: copy.type, actorId: opts.actorId ?? null },
    );
  } catch {
    /* Rule 3. A like must never fail because a notification did. */
  }
}
