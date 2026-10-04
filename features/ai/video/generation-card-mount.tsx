"use client";

import dynamic from "next/dynamic";

/**
 * The card's door.
 *
 * `AiStudioShell` is a SERVER component on purpose — the 2026-09-28 white
 * screen was caused by making it a client component that rendered its
 * children, which put the whole AI subtree behind its bundle. So the card
 * cannot be imported there directly; it arrives through this wrapper, which
 * is the only client thing the shell mounts besides the rail.
 *
 * `ssr: false` because the store reads `sessionStorage`, which does not exist
 * on the server — and because a card for a generation that may not exist has
 * nothing useful to render into the HTML.
 *
 * No loading state: this is an overlay that is absent until a generation is
 * running, and a placeholder would reserve space for something not coming.
 */
const AiGenerationProgressCard = dynamic(
  () => import("@/features/ai/video/generation-progress-card").then((m) => m.AiGenerationProgressCard),
  { ssr: false },
);

export function AiGenerationCardMount() {
  return <AiGenerationProgressCard />;
}
