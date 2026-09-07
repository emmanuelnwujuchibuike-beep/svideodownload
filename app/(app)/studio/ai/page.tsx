import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FrenzAIHeader } from "@/features/ai/frenz-ai-header";
import { FrenzAIToolCard } from "@/features/ai/frenz-ai-tool-card";
import { FRENZ_AI_STUDIO_TOOLS } from "@/lib/ai/studio-tools";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Frenz AI" };

/**
 * Frenz AI — the hub (Part 1).
 *
 * ── Why it lives inside Studio ────────────────────────────────────────────
 * Frenzsave → Frenz Studio → Frenz AI → a tool. Mounting it here means it
 * inherits the Studio shell's nav, its `noindex`, and its signed-in gate for
 * free, and it puts the AI tools beside the creator's own work rather than in a
 * separate destination that would have to justify its own chrome. The nav tab is
 * one line in `features/studio/studio-nav.tsx`; nothing else in the app's
 * navigation moved.
 *
 * ── Server-rendered, and it fetches nothing ───────────────────────────────
 * The tool list is a static registry (`lib/ai/studio-tools.ts`), so this page is
 * markup over a constant. The only round trip is the user check the Studio
 * pages all repeat — a layout does not re-run per navigation, so it cannot be
 * the only gate.
 */
export default async function FrenzAIPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/ai");

  return (
    <div>
      <FrenzAIHeader
        title="Create more. Edit smarter."
        description="Powerful AI tools designed to help you transform your content faster."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {FRENZ_AI_STUDIO_TOOLS.map((tool) => (
          <FrenzAIToolCard key={tool.id} tool={tool} />
        ))}
      </div>

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        More tools are on the way. Anything marked coming soon isn&apos;t built yet — you&apos;ll see it here
        the moment it is.
      </p>
    </div>
  );
}
