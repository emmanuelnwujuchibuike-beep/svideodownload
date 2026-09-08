import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FrenzAIHub } from "@/features/ai/frenz-ai-hub";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Frenz AI" };

/**
 * Frenz AI — the hub, inside Studio.
 *
 * ── Rebuilt from the owner's reference, 2026-09-08 ────────────────────────
 * `public/frenz ai page.jpg`, with the instruction "build everything exactly
 * in details as it in the image, dont skip or simplify any thing". The whole
 * composition lives in `FrenzAIHub` so this page and the public one cannot
 * drift; see that file for what each annotation on the image became.
 *
 * ── Why it stays inside Studio ────────────────────────────────────────────
 * Frenzsave → Frenz Studio → Frenz AI → a tool. Mounting it here means it
 * inherits the Studio shell's nav — the exact Home / Frenz AI / Content /
 * Audience row drawn across the top of the reference — and puts the AI tools
 * beside the creator's own work rather than in a separate destination that
 * would have to justify its own chrome.
 *
 * ── 🔴 AND THIS ONE IS `noindex`, WHICH IS WHY IT MAY SAY "COMING SOON" ───
 * The Studio layout sets `robots: { index: false }` and redirects a signed-out
 * visitor, so no crawler reaches this page. That is what lets it carry the
 * reference's exact wording while the standing "no soon anywhere" rule — which
 * exists for the AdSense review of INDEXED pages — is still honoured where it
 * actually applies. The public surface passes different copy; see
 * FrenzAIRoadmap.
 *
 * ── Server-rendered, and it fetches nothing ───────────────────────────────
 * The tool list is a static registry (`lib/ai/studio-tools.ts`), so this page
 * is markup over a constant. The only round trip is the user check the Studio
 * pages all repeat — a layout does not re-run per navigation, so it cannot be
 * the only gate.
 */
export default async function FrenzAIPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai");

  return <FrenzAIHub />;
}
