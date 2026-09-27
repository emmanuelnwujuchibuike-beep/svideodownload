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
export default async function StudioLipSyncPage({ searchParams }: { searchParams: Promise<{ audio?: string; voice?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/lip-sync");
  // 2026-09-21: "Use in Lip Sync Pro" from the Audio Library arrives as ?audio=<assetId>
  const { audio, voice } = await searchParams;
  const initialAssetId = typeof audio === "string" && /^[0-9a-fA-F-]{36}$/.test(audio) ? audio : null;
  // 2026-09-27: "Use in Lip Sync Pro" from the Voice Library arrives as ?voice=clone:<uuid>
  const initialVoiceId = typeof voice === "string" && /^clone:[0-9a-fA-F-]{36}$/.test(voice) ? voice : null;
  return <LipSyncWorkspace basePath="/studio/ai/lip-sync" aiHref="/studio/ai" historyHref="/studio/ai/history" usageHref="/studio/ai/usage" audioHref="/studio/ai/audio" initialAssetId={initialAssetId} initialVoiceId={initialVoiceId} />;
}
