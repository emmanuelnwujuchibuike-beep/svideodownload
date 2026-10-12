import { avatarSrc } from "@/lib/media/avatar-url";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * RICH IDENTITY for a push (Feature 20 Part 4; owner 2026-10-12: "messages with
 * users, post engagement, wallpaper engagement should show the user's avatar and
 * title, just like WhatsApp and Instagram. Frenz logo as the avatar only on system
 * notifications like withdraw, deposit").
 *
 * A push about a PERSON leads with them: their name is the title, their photo is
 * the icon, and what they did is the body. A system push sends no icon, so the
 * service worker uses the Frenz logo (public/sw/push.js `data.icon || "/icon.png"`).
 *
 * Only an https photo travels (a data: or relative URL would break or leak); no
 * photo → the Frenz logo. iOS web push always shows the app icon whatever is sent
 * — a platform rule; Android and desktop show the photo.
 */
export interface PushPerson {
  name: string;
  handle: string | null;
  icon: string | undefined;
}

export async function pushPerson(userId: string | null | undefined): Promise<PushPerson> {
  if (!userId) return { name: "Someone", handle: null, icon: undefined };
  try {
    const { data } = await createAdminClient().from("profiles").select("display_name, handle, avatar_url").eq("id", userId).maybeSingle();
    const r = data as { display_name?: string | null; handle?: string | null; avatar_url?: string | null } | null;
    const handle = r?.handle ?? null;
    const avatar = r?.avatar_url ?? null;
    return {
      name: ((r?.display_name || (handle ? `@${handle}` : "")) || "Someone").slice(0, 60),
      handle,
      // a 192 px render, not the original upload: Android draws the large icon at ~64 dp, and a
      // multi-megabyte photo slows the notification on mobile data (notifications Part 2)
      icon: avatar && /^https:\/\/[^\s"'<>]+$/.test(avatar) ? avatarSrc(avatar, 96) : undefined,
    };
  } catch {
    return { name: "Someone", handle: null, icon: undefined };
  }
}
