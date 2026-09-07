"use client";

import { Sparkles } from "lucide-react";

import { AICleanUpload } from "@/features/ai/ai-clean-upload";

/**
 * What the stage holds before anything is chosen.
 *
 * ── One obvious action ────────────────────────────────────────────────────────
 * Eyebrow, one line of promise, then the drop zone. Nothing else. The temptation
 * on an empty screen is to fill it — a feature tour, three benefit tiles, an
 * illustration that owns the fold — and every one of those competes with the
 * single thing the person came here to do. The upload panel is the largest,
 * highest-contrast object on the page, which is the whole design.
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
      <div className="mb-5 text-center">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.16em] text-primary">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          AI Clean
        </span>
        <p className="mt-2 text-sm text-muted-foreground">Remove unwanted text from your videos.</p>
      </div>

      <AICleanUpload onFile={onFile} onPasteLink={onPasteLink} />
    </div>
  );
}
