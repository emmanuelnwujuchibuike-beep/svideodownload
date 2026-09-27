import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { VoiceCloningWorkspace } from "@/features/ai/voice-clone/voice-cloning-workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Voice Cloning" };

/**
 * /studio/ai/voice-cloning — the standalone Voice Cloning tool (2026-09-27):
 * the member's recordings in, a voice they own out. No video pipeline anywhere.
 * Signed out: to sign-in and back. Never static under the studio (the
 * cookie-reading layout would prerender the redirect).
 *
 * `?job=` opens a past clone (the push and the history tile both use it).
 */
export default async function StudioVoiceCloningPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/voice-cloning");
  const { job } = await searchParams;
  const initialJobId = typeof job === "string" && /^[0-9a-fA-F-]{36}$/.test(job) ? job : null;
  return (
    <VoiceCloningWorkspace
      basePath="/studio/ai/voice-cloning"
      aiHref="/studio/ai"
      ttaHref="/studio/ai/text-to-audio"
      lipSyncHref="/studio/ai/lip-sync"
      historyHref="/studio/ai/history"
      usageHref="/studio/ai/usage"
      initialJobId={initialJobId}
    />
  );
}
