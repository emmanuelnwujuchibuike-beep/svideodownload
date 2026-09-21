import type { Metadata } from "next";

import { FrenzAIExplore } from "@/features/ai/frenz-ai-explore";

/**
 * /studio/ai/character-replace — Explore AI Studio (the Studio-shell door).
 *
 * 2026-09-20, owner: "put the entire AI tool section down to AI credits and
 * usage in the Explore AI Studio page… remove the AI structure and use the grid
 * that has all AI features." This route used to be the "What do you want to
 * replace?" scope page; it now renders the studio — the four scopes are the
 * first four cards — so the workspace's Replace step, the Paystack returns
 * and every older link (`?job=` included) still land where they should.
 *
 * ⚠️ NOT `force-static`. The scope page was, inside a layout that calls
 * `getUser()`: the layout's redirect was prerendered INTO the page
 * (`location: /login?next=/studio`), and every member who tapped it in the
 * Studio shell was sent to Creator Studio. The route renders per request.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Explore AI Studio" };

export default function StudioExploreAIPage() {
  return <FrenzAIExplore createPath="/studio/ai/character-replace/create" aiHref="/studio/ai" historyHref="/studio/ai/history" usageHref="/studio/ai/usage" />;
}
