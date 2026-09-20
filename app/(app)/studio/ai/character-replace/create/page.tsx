import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CharacterReplaceWorkspace } from "@/features/ai/character-replace/character-replace-workspace";
import { isReplacementMode } from "@/lib/ai/character-replace/modes";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Character Replace" };

/**
 * /studio/ai/character-replace/create?mode=… — the workspace, opened on the
 * photo step with the scope chosen on the page before. An unknown or missing
 * scope opens Full Character (the reducer's default); the chip in the header
 * goes back to change it. `?job=` (an older history link) opens that job.
 */
export default async function StudioCharacterReplaceCreatePage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/character-replace");
  const { mode } = await searchParams;

  return (
    <CharacterReplaceWorkspace
      basePath="/studio/ai/character-replace/create"
      modeHref="/studio/ai/character-replace"
      aiHref="/studio/ai"
      historyHref="/studio/ai/history"
      initialMode={isReplacementMode(mode) ? mode : null}
    />
  );
}
