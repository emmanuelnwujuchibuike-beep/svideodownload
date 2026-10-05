import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { TextToAudioWorkspace } from "@/features/ai/text-to-audio/text-to-audio-workspace";
import { getShowcaseSlides } from "@/lib/ai/showcase/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Text to Audio" };

/**
 * /studio/ai/text-to-audio — the standalone Text to Audio tool (2026-09-21):
 * text in, audio out, saved to the member's Audio Library. No video pipeline.
 * Signed out: to sign-in and back. Never static under the studio (the
 * cookie-reading layout would prerender the redirect).
 *
 * `?job=` opens a past generation (the push and the history tile both use it).
 */
export default async function StudioTextToAudioPage({ searchParams }: { searchParams: Promise<{ job?: string; voice?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/text-to-audio");
  const { job, voice } = await searchParams;
  // The showcase opens every AI page (owner's reference); cached until an admin saves.
  const slides = await getShowcaseSlides();
  const initialJobId = typeof job === "string" && /^[0-9a-fA-F-]{36}$/.test(job) ? job : null;
  // 2026-09-27: "Make audio with it" from the Voice Library arrives as ?voice=clone:<uuid>
  const initialVoiceId = typeof voice === "string" && /^clone:[0-9a-fA-F-]{36}$/.test(voice) ? voice : null;
  return (
    <TextToAudioWorkspace
      basePath="/studio/ai/text-to-audio"
      aiHref="/studio/ai"
      libraryHref="/studio/ai/audio"
      lipSyncHref="/studio/ai/lip-sync"
      historyHref="/studio/ai/history"
      usageHref="/studio/ai/usage"
      initialJobId={initialJobId}
      initialVoiceId={initialVoiceId}
      slides={slides}
    />
  );
}
