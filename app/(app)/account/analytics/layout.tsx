import { Gem } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppContent } from "@/features/app-shell/app-content";
import { getUserPlan } from "@/lib/monetization/plan";
import { createClient } from "@/lib/supabase/server";

import "./analytics.css";

/**
 * Creator analytics — every screen (design/creator-analytics.html). One gate for all of them: signed in, Business plan
 * (the same rule the old page had, and the API checks again). The design tokens load here only. The app's own top
 * bar and bottom tabs stay — they belong to the (app) shell above this layout.
 */
export default async function CreatorAnalyticsLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/analytics");
  const plan = await getUserPlan(user.id);
  return (
    <AppContent>
      <div className="ca-root relative -mx-4 min-h-screen overflow-hidden pb-28 sm:mx-auto sm:max-w-[560px] sm:rounded-[32px]">
        {plan !== "business" ? <Locked /> : children}
      </div>
    </AppContent>
  );
}

function Locked() {
  return (
    <div className="mx-4 mt-8 rounded-3xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.06] to-transparent p-8 text-center">
      <Gem className="mx-auto h-10 w-10 text-amber-500" aria-hidden />
      <h1 className="mt-4 text-xl font-bold">Creator analytics is a Business feature</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--ca-sub)]">Upgrade to Business to see your engagement, earnings, gifts, posts, AI creations and your audience in one place.</p>
      <Link href="/pricing#business" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-500/25">
        <Gem className="h-4 w-4" aria-hidden /> Upgrade to Business
      </Link>
    </div>
  );
}
