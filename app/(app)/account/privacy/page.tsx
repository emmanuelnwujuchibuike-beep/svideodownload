import { ArrowLeft, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { UserList } from "@/components/social/user-list";
import { AppContent } from "@/features/app-shell/app-content";
import { DataControls } from "@/features/account/data-controls";
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
    <AppContent>
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center gap-3">
          <Link
            href="/account"
            aria-label="Back to account"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/80 transition hover:bg-secondary"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
              <Lock className="h-6 w-6 text-muted-foreground" /> Privacy
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Who can see your stuff, blocked &amp; muted accounts, and your data.</p>
          </div>
        </header>

        <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
          <PrivacyEditor settings={privacy} />

          <div className="border-b border-border/60 p-6 sm:p-8">
            <h2 className="mb-3 text-sm font-semibold">Blocked accounts</h2>
            {blocked.length > 0 ? (
              <UserList users={blocked} viewerId={user.id} mode="blocked" />
            ) : (
              <p className="text-xs text-muted-foreground">Nobody&apos;s blocked.</p>
            )}
          </div>

          <div className="border-b border-border/60 p-6 sm:p-8">
            <h2 className="mb-3 text-sm font-semibold">Muted accounts</h2>
            {muted.length > 0 ? (
              <UserList users={muted} viewerId={user.id} mode="muted" />
            ) : (
              <p className="text-xs text-muted-foreground">Nobody&apos;s muted.</p>
            )}
          </div>

          <DataControls />
        </div>
      </div>
    </AppContent>
  );
}
