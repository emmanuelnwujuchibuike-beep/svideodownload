import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FrenzAIUsagePage } from "@/features/ai/frenz-ai-usage-page";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your Frenz AI usage" };

/**
 * /studio/ai/usage — the signed-in door to the same page.
 *
 * One component, two routes, exactly like `/ai/history` and
 * `/studio/ai/history`. The Studio shell brings the gate, `noindex` and the
 * nav; this page re-checks the user because a layout does not re-run per
 * navigation, which is what every other Studio page does.
 */
export default async function StudioFrenzAIUsagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/usage");

  return <FrenzAIUsagePage aiHref="/studio/ai" />;
}
