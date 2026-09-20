import type { Metadata } from "next";

import { CharacterReplaceModePage } from "@/features/ai/character-replace/mode-page";

/**
 * /studio/ai/character-replace — "What do you want to replace?", the tool's
 * front door (owner, 2026-09-20). Static on purpose: the four scopes are
 * drawn from pure copy, the prices hydrate from a cached read, every card is
 * a prefetched link to /create, and a back-swipe returns from the router
 * cache. Middleware keeps a signed-out visitor out of /studio; every AI
 * endpoint refuses an anonymous subject on its own.
 */
export const dynamic = "force-static";
export const metadata: Metadata = { title: "Character Replace" };

export default function StudioCharacterReplacePage() {
  return <CharacterReplaceModePage createPath="/studio/ai/character-replace/create" aiHref="/studio/ai" historyHref="/studio/ai/history" />;
}
