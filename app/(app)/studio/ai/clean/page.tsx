import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AICleanWorkspace } from "@/features/ai/ai-clean-workspace";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI Clean" };

/**
 * AI Clean — the first Frenz AI tool (Part 1: interface only).
 *
 * ── A thin server page over one client workspace ──────────────────────────
 * Everything on this screen reacts to something the person does — a file lands,
 * a link is typed, the tutorial opens — so the whole surface is one client
 * component. It still renders on the server: the header, the empty state and the
 * drop zone are in the first HTML, which is what stops the PWA showing a blank
 * frame before hydration and is why the tutorial can arrive over a page that is
 * already there.
 *
 * 🔴 Nothing on this route touches a model, an upload or a job. The processing
 * pipeline is a later part, and the ready state says so on screen rather than
 * animating a progress bar over nothing.
 */
export default async function AICleanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai/clean");

  return <AICleanWorkspace historyHref="/studio/ai/history" />;
}
