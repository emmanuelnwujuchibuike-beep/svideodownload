import { notFound } from "next/navigation";

import { AICleanProcessing } from "@/features/ai/ai-clean-processing";
import { FrenzAIHub } from "@/features/ai/frenz-ai-hub";
import { stageFor } from "@/lib/ai/job-stages";

/**
 * A scratch mount for `scripts/frenz-ai-shots.mjs`.
 *
 * 🔴 DEVELOPMENT ONLY — `notFound()` in production, so it can never be reached
 * on the live site even if deployed by accident.
 *
 * It renders the REAL components with no mocks. A harness that stubs the thing
 * it photographs proves nothing, which is how a "use client" crash on this very
 * feature once got past a build.
 *
 * ⚠️ Deliberately a SERVER component: the hub is one, and the bug it once had
 * only appears when a server parent renders it.
 */
export const dynamic = "force-dynamic";

export default async function FrenzAIProbePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view } = await searchParams;

  if (view === "processing") {
    return (
      <main className="mx-auto max-w-2xl px-3 py-6">
        <AICleanProcessing
          view={stageFor({ job: { status: "processing" } as never })}
          fileName="snaptik_7681992753605053717.mp4"
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-3 py-6">
      <FrenzAIHub />
    </main>
  );
}
