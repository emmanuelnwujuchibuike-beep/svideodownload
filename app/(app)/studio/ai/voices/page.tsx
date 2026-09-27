import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { VoiceLibrary } from "@/features/ai/voice-clone/voice-library";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your Voices" };

/** /studio/ai/voices — the member's cloned voices, on their own page. Never static under the studio shell. */
export default async function StudioVoicesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/voices");
  return <VoiceLibrary cloneHref="/studio/ai/voice-cloning" ttaHref="/studio/ai/text-to-audio" lipSyncHref="/studio/ai/lip-sync" />;
}
