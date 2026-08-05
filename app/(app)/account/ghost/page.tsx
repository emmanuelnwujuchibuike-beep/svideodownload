import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { GhostModePanel } from "@/features/account/ghost-mode";
import { SettingsPage } from "@/features/account/settings-page";
import { readGhostState } from "@/lib/privacy/ghost";
import { getOwnPresenceStatus } from "@/lib/social/presence-status";
import { getPrivacySettings } from "@/lib/social/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ghost Mode", robots: { index: false, follow: false } };

/**
 * /account/ghost — the activity signals you give off (Feature 18 · Part 19).
 *
 * Reads the settings that already exist rather than any new storage: privacy
 * settings (0006/0060/0106) and the presence status (0043). The state shown is
 * therefore derived from the same rows the rest of the app enforces, so this
 * screen cannot disagree with reality.
 */
export default async function GhostModePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/ghost");

  const [privacy, presence] = await Promise.all([
    getPrivacySettings(user.id),
    getOwnPresenceStatus(user.id),
  ]);

  const state = readGhostState({
    presenceStatus: presence,
    lastSeenVisibility: privacy.last_seen_visibility as string | null,
    typingEnabled: privacy.typing_indicators_enabled as boolean | null,
    readReceiptsEnabled: privacy.read_receipts_enabled as boolean | null,
    activityVisibility: privacy.activity_visibility as string | null,
    showViews: privacy.show_views as boolean | null,
  });

  return (
    <SettingsPage
      title="Ghost Mode"
      description="Turn down the signals you give off, without leaving."
      bare
    >
      <GhostModePanel initial={state} />
    </SettingsPage>
  );
}
