import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { UserList } from "@/components/social/user-list";
import { DataControls } from "@/features/account/data-controls";
import { SettingsGroup } from "@/features/account/settings-ui";
import { SettingsPage } from "@/features/account/settings-page";
import { PrivacyEditor } from "@/features/social/privacy-editor";
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

  const [privacy, blocked, muted] = await Promise.all([
    getPrivacySettings(user.id),
    listBlocked(user.id),
    listMutedCreators(user.id),
  ]);

  return (
    <SettingsPage title="Privacy" description="Who can see your stuff, blocked & muted accounts, and your data." bare>
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
