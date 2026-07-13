import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppContent } from "@/features/app-shell/app-content";
import { TrustCenter } from "@/features/friends/trust-center";
import { listOwnReports } from "@/lib/social/moderation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trust Center",
  robots: { index: false, follow: false },
};

/**
 * Part 11c — Friendship Trust Center: the safety-focused hub for the Friends
 * surface specifically (distinct from /account/privacy, which is the
 * general account-wide privacy hub) — what you've reported and what
 * happened to it, quick links to blocked/muted management and appeals, and
 * real safety guidance.
 */
export default async function TrustCenterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/friends/trust");

  const reports = await listOwnReports(user.id);

  return (
    <AppContent>
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center gap-3">
          <Link
            href="/friends"
            aria-label="Back to friends"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-card/80 transition hover:bg-secondary"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
              <ShieldCheck className="h-6 w-6 text-muted-foreground" /> Trust Center
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Your reports, safety controls, and guidance.</p>
          </div>
        </header>

        <TrustCenter reports={reports} />
      </div>
    </AppContent>
  );
}
