import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AudioLibrary } from "@/features/ai/text-to-audio/audio-library";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audio Library" };

/** /studio/ai/audio — the member's saved Text to Audio results (the brief §6). Never static under the studio shell. */
export default async function StudioAudioLibraryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/audio");
  return <AudioLibrary ttaHref="/studio/ai/text-to-audio" lipSyncHref="/studio/ai/lip-sync" aiHref="/studio/ai" />;
}
