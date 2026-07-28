import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { ActiveSessions } from "@/features/account/active-sessions";
import { MfaEditor } from "@/features/account/mfa-editor";
import { PasskeysEditor } from "@/features/account/passkeys-editor";
import { PinSettingsEditor } from "@/features/account/pin-settings-editor";
import { RecoveryCodesPanel } from "@/features/account/recovery-codes-panel";
import { SecurityActivity } from "@/features/account/security-activity";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Security",
  robots: { index: false, follow: false },
};

export default async function AccountSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ recovered?: string }>;
}) {
  const { recovered } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/security");

  return (
    <SettingsPage title="Security" description="Two-factor authentication, passkeys, devices, and recent activity." bare>
      {recovered === "1" ? (
        <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-600 dark:text-amber-400">
          <KeyRound className="h-4 w-4 shrink-0" /> Two-factor authentication was turned off using a recovery code. Set it up again below if you&apos;d like.
        </div>
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
        <MfaEditor />
        <RecoveryCodesPanel />
        <PasskeysEditor />
        <PinSettingsEditor />
        <ActiveSessions />
        <SecurityActivity />
      </div>
    </SettingsPage>
  );
}
