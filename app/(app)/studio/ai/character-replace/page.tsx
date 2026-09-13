import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CharacterReplaceWorkspace } from "@/features/ai/character-replace/character-replace-workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Character Replace" };

/**
 * /studio/ai/character-replace — the same workspace inside the Studio shell.
 * One component, two doors, exactly like /ai/history and its Studio twin;
 * this is also where the push notification's `?job=` link lands.
 */
export default async function StudioCharacterReplacePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/character-replace");

  return <CharacterReplaceWorkspace basePath="/studio/ai/character-replace" aiHref="/studio/ai" historyHref="/studio/ai/history" />;
}
