import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ImageToVideoWorkspace } from "@/features/ai/video/image-to-video-workspace";
import { aiCurrencySymbol } from "@/lib/landing/bounds";
import { getLandingSettings } from "@/lib/landing/settings";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Image to Video" };
/**
 * /studio/ai/image-to-video — the direct-Kling Image to Video tool.
 *
 * 🔴 Never static. The studio layout reads cookies, and `force-static` under it
 * prerenders the signed-out redirect — a recorded outage on this project.
 */
export const dynamic = "force-dynamic";

export default async function StudioImageToVideoWorkspacePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/image-to-video");
  const settings = await getLandingSettings();
  return <ImageToVideoWorkspace historyHref="/studio/ai/history" currencySymbol={aiCurrencySymbol(settings.frenzAiCurrency)} />;
}
