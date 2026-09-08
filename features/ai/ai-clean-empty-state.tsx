"use client";

import { AICleanUpload } from "@/features/ai/ai-clean-upload";
import { FrenzAICore } from "@/features/ai/core/frenz-ai-core";

/**
 * What the stage holds before anything is chosen.
 *
 * ── One obvious action ────────────────────────────────────────────────────────
 * The Core, one line of promise, then the drop zone. Nothing else. The
 * temptation on an empty screen is to fill it — a feature tour, three benefit
 * tiles, an illustration that owns the fold — and every one of those competes
 * with the single thing the person came here to do. The upload panel is still
 * the largest, highest-contrast object here.
 *
 * The Core sits above it breathing quietly (2026-09-07). That is the difference
 * between an empty form and a room with something in it that is waiting for
 * you — and it costs one composited layer on a 24-second cycle that stops the
 * moment the tab is hidden.
 */
export function AICleanEmptyState({
  onFile,
  onPasteLink,
}: {
  onFile: (file: File) => void;
  onPasteLink: () => void;
}) {
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-col items-center text-center">
        <FrenzAICore presence="calm" size="lg" />
        <span className="mt-4 text-[11px] font-bold uppercase tracking-[0.22em] text-primary">AI Clean</span>
        <p className="mt-1.5 text-sm text-muted-foreground">Remove unwanted text from your videos.</p>
      </div>

      <AICleanUpload onFile={onFile} onPasteLink={onPasteLink} />
    </div>
  );
}
