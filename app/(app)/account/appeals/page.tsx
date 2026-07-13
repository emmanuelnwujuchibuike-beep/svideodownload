import { ArrowLeft, MessageSquareWarning } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppContent } from "@/features/app-shell/app-content";
import { AppealsPanel } from "@/features/account/appeals-panel";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Appeals",
  robots: { index: false, follow: false },
};

export default async function AccountAppealsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/appeals");

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
              <MessageSquareWarning className="h-6 w-6 text-muted-foreground" /> Appeals
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">Ask for a second look on a moderation action.</p>
          </div>
        </header>

        <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
          <AppealsPanel />
        </div>
      </div>
    </AppContent>
  );
}
