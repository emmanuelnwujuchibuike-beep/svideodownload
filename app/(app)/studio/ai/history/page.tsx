import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FrenzAIHistoryPage } from "@/features/ai/frenz-ai-history-page";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your Frenz AI videos" };

/**
 * /studio/ai/history — the signed-in door to the same page.
 *
 * One component, two routes, exactly like `/ai/clean` and `/studio/ai/clean`:
 * the list has never known or cared whether the visitor is signed in, because
 * `GET /api/ai/jobs` resolves the subject itself. Forking it would have been
 * two implementations of one screen, drifting.
 *
 * The Studio shell brings the signed-in gate, `noindex` and the nav for free —
 * and this page re-checks the user because a layout does not re-run per
 * navigation, which is what every other Studio page does.
 */
export default async function StudioFrenzAIHistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/history");

  return <FrenzAIHistoryPage />;
}
