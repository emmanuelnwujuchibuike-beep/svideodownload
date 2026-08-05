import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { UserList } from "@/components/social/user-list";
import { DataControls } from "@/features/account/data-controls";
import { SettingsGroup } from "@/features/account/settings-ui";
import { SettingsPage } from "@/features/account/settings-page";
import { VisibilitySummary } from "@/features/account/visibility-summary";
import { PrivacyEditor } from "@/features/social/privacy-editor";
import { visibilitySummary } from "@/lib/privacy/visibility";
import { getDiscoverySettings } from "@/lib/social/discovery-settings";
import { getOwnProfile } from "@/lib/social/profile";
import { getPrivacySettings, listBlocked, listMutedCreators } from "@/lib/social/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy",
  robots: { index: false, follow: false },
};

/**
 * Part 11c — Privacy Dashboard: everything that controls who can see/reach
 * you and what happens to your data, consolidated in one place (was
 * scattered across the crowded main /account page). Security/auth stuff
 * (2FA, passkeys, devices) stays on its own /account/security page — this
 * is deliberately the PRIVACY half, not the AUTH half.
 */
export default async function AccountPrivacyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/privacy");

  const [privacy, blocked, muted, discovery, own] = await Promise.all([
    getPrivacySettings(user.id),
    listBlocked(user.id),
    listMutedCreators(user.id),
    getDiscoverySettings(user.id),
    getOwnProfile(user.id),
  ]);

  /*
    The brief's actual complaint is that privacy is CONFUSING, not that the
    controls are missing — Frenz already has ~20 of them across four screens.
    So the page now opens with the answer to the question people have ("who
    can see me?") and keeps the switches underneath.

    Derived at render from the same columns the enforcement reads, so the
    sentence and the behaviour cannot drift apart.
  */
  const summary = visibilitySummary({
    profileVisibility: own?.visibility ?? null,
    activityVisibility: privacy.activity_visibility as string | null,
    followersVisibility: privacy.followers_visibility as string | null,
    // The 0112 relationship columns land at runtime before this interface is
    // widened, so they are read through `unknown` instead of the type being
    // told a lie about what it holds.
    friendsVisibility: (privacy as unknown as Record<string, unknown>).friends_visibility as string | null,
    followingVisibility: (privacy as unknown as Record<string, unknown>).following_visibility as string | null,
    commentsPolicy: privacy.comments_policy as string | null,
    messagesPolicy: privacy.messages_policy as string | null,
    allowIndexing: privacy.allow_indexing as boolean | null,
    showInRecommendations: privacy.show_in_recommendations as boolean | null,
    discoverable: discovery.discoverable,
    discoveryFields: discovery.fields,
  });

  return (
    <SettingsPage title="Privacy" description="Who can see your stuff, blocked & muted accounts, and your data." bare>
      <VisibilitySummary lines={summary} />

      <PrivacyEditor settings={privacy} />

      <SettingsGroup label="BLOCKED ACCOUNTS">
        <div className="p-3.5">
          {blocked.length > 0 ? <UserList users={blocked} viewerId={user.id} mode="blocked" /> : <p className="text-xs text-muted-foreground">Nobody&apos;s blocked.</p>}
        </div>
      </SettingsGroup>

      <SettingsGroup label="MUTED ACCOUNTS">
        <div className="p-3.5">
          {muted.length > 0 ? <UserList users={muted} viewerId={user.id} mode="muted" /> : <p className="text-xs text-muted-foreground">Nobody&apos;s muted.</p>}
        </div>
      </SettingsGroup>

      <SettingsGroup label="YOUR DATA">
        <DataControls />
      </SettingsGroup>
    </SettingsPage>
  );
}
