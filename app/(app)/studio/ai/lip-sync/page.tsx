import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LipSyncWorkspace } from "@/features/ai/lip-sync/lip-sync-workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Lip Sync Pro" };

/**
 * /studio/ai/lip-sync — the Lip Sync Pro workspace (2026-09-21): a video and
 * ONE speech source (typed text, or an uploaded audio file). Signed out: to
 * sign-in and back. Never static under the studio (the cookie-reading layout
 * would prerender the redirect).
 */
export default async function StudioLipSyncPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/lip-sync");
  return <LipSyncWorkspace basePath="/studio/ai/lip-sync" aiHref="/studio/ai" historyHref="/studio/ai/history" usageHref="/studio/ai/usage" />;
}
