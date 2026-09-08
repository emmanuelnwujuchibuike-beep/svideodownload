import { notFound } from "next/navigation";

import { FrenzAIHub } from "@/features/ai/frenz-ai-hub";

/**
 * A scratch mount for `scripts/frenz-ai-shots.mjs`.
 *
 * 🔴 DEVELOPMENT ONLY — `notFound()` in production, so this can never be
 * reached on the live site even if it is deployed by accident.
 *
 * It exists because the real hub lives behind the Studio auth redirect, and a
 * screenshot harness that has to log in first is a harness nobody runs. The
 * important property is that it renders the REAL component with no props and no
 * mocks: a harness that stubs the thing it is photographing proves nothing,
 * which is how a "use client" crash on this very feature got past a build once
 * before.
 *
 * ⚠️ Deliberately a SERVER component, for the same reason. The hub is a server
 * component and the bug it once had only appears when a server parent renders
 * it; a client-component harness would mask exactly the failure worth catching.
 */
export const dynamic = "force-dynamic";

export default function FrenzAIProbePage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto max-w-2xl px-3 py-6">
      <FrenzAIHub />
    </main>
  );
}
