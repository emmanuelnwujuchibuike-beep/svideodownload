import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FrenzAIWelcome } from "@/features/ai/frenz-ai-welcome";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Frenz AI" };

/**
 * Frenz AI — the first thing you see when you tap the tab.
 *
 * ── Rebuilt as a WELCOME page, 2026-09-08 ─────────────────────────────────
 * Owner: "use the image description Frenz AI welcome page as the first page
 * when a user click the Frenz AI button, and after that when Try AI Clean is
 * clicked it opens the existing Frenz AI landing but without the hero section."
 *
 * So this route is now `public/frenz ai welcome page.jpg` — the before/after
 * scene, the two actions, the allowance and the trust row — and "Try AI Clean"
 * goes to /studio/ai/clean, which carries the input design from
 * `public/ai input page.jpg`.
 *
 * ⚠️ The previous hub (the Core, "Create more. Edit smarter.", the AI Clean
 * card and the roadmap panel) is NOT deleted — `features/ai/frenz-ai-hub.tsx`
 * still exists and is what a public, crawlable Frenz AI page will render. It is
 * simply no longer what this route shows.
 *
 * Server-rendered and it fetches nothing but the session; the allowance is the
 * one live value and the welcome component asks for it on mount.
 */
export default async function FrenzAIPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai");

  return <FrenzAIWelcome />;
}
