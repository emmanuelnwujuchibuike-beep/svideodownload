import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { LayoutStudio } from "@/features/profile/layout-studio";
import { accentHex, getProfileExtras } from "@/lib/social/profile";
import { getProfileAppearance } from "@/lib/social/profile-appearance";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Layout Studio", robots: { index: false, follow: false } };

/**
 * Profile Layout Studio™ — theme, cards, corners and text size, with a live
 * preview (Feature 18 · Part 16).
 *
 * Which SECTIONS a profile shows, in what order and to whom, is a separate
 * screen (/account/modules, Part 14) — deliberately, because they are different
 * questions: "what is on my profile" versus "what does it look like". Each links
 * to the other rather than one screen trying to be both.
 */
export default async function LayoutStudioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [appearance, extras] = await Promise.all([getProfileAppearance(user.id), getProfileExtras(user.id)]);

  return (
    <SettingsPage title="Layout Studio" description="How your profile looks. Changes preview instantly." bare>
      <LayoutStudio initial={appearance} accent={accentHex(extras.accent)} />

      <p className="mt-5 rounded-2xl bg-secondary/40 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
        Looking for which sections appear and in what order?{" "}
        <Link href="/account/modules" prefetch className="font-semibold text-primary hover:underline">
          Profile sections
        </Link>{" "}
        handles that. Your accent colour lives in{" "}
        <Link href="/account/identity/accent" prefetch className="font-semibold text-primary hover:underline">
          Identity
        </Link>
        .
      </p>
    </SettingsPage>
  );
}
