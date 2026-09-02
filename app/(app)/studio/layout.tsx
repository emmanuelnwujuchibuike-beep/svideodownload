import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppContent } from "@/features/app-shell/app-content";
import { StudioNav } from "@/features/studio/studio-nav";
import { createClient } from "@/lib/supabase/server";

/**
 * Creator Studio shell (Feature 15 · Part 9).
 *
 * ── Not indexed, and not shared ─────────────────────────────────────────
 * Every Studio page is a creator's own private dashboard. `robots: noindex` is
 * belt and braces on top of the auth redirect — a signed-out crawler gets the
 * redirect, and a leaked URL still tells search engines to stay away.
 *
 * ── Why the auth check is here and repeated on each page ────────────────
 * A layout in the App Router does not re-run for every child navigation, so it
 * cannot be the only gate. Each page re-reads the user and every data function
 * scopes by that id; this check is the fast redirect, not the security.
 */

export const metadata: Metadata = {
  title: { default: "Creator Studio", template: "%s · Creator Studio" },
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function StudioLayout({ children }: { children: ReactNode }) {
  if (!hasSupabase) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio");

  return (
    <AppContent>
      <div className="mx-auto max-w-5xl">
        <StudioNav />
        {children}
      </div>
    </AppContent>
  );
}
