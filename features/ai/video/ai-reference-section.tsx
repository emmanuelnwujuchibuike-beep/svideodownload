"use client";

import { ImageIcon, Plus } from "lucide-react";
import { useState } from "react";

import { AiReferenceRail, type AiReferenceRailProps } from "@/features/ai/video/ai-reference-rail";
import { cn } from "@/lib/utils";

/**
 * "Add Reference (Optional) · Use an image to guide your video. [+ Upload Image]"
 * — the owner's reference row (2026-10-05), in front of the EXISTING rail.
 *
 * Collapsed, it is one quiet row. "Upload Image" opens the rail itself
 * (AiReferenceRail — up to seven images and a video, uploads, validation, the
 * counter, all unchanged). It opens on its own as soon as anything is
 * attached, so a member never has references they cannot see.
 *
 * Nothing is uploaded or fetched until the member picks a file; collapsing
 * keeps what is attached.
 */
export function AiReferenceSection(props: AiReferenceRailProps) {
  const has = props.images.length > 0 || !!props.videoUrl;
  const [open, setOpen] = useState(false);
  const shown = open || has;

  return (
    <div className={cn("rounded-2xl bg-card ring-1 ring-inset ring-black/[0.07] dark:ring-white/10", props.className)}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
          <ImageIcon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold leading-tight">
            Add Reference <span className="text-[11.5px] font-normal text-muted-foreground">(Optional)</span>
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">Use an image to guide your video.</span>
        </span>
        {has ? null : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={shown}
            disabled={props.disabled}
            className="inline-flex min-h-[2.5rem] shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-indigo-300/80 px-3 text-[12.5px] font-semibold text-indigo-700 transition active:scale-[0.97] disabled:opacity-50 dark:text-indigo-200 [@media(hover:hover)]:hover:bg-indigo-50/70"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {shown ? "Close" : (
              <>
                <span className="min-[400px]:hidden">Upload</span>
                <span className="hidden min-[400px]:inline">Upload Image</span>
              </>
            )}
          </button>
        )}
      </div>
      {shown ? <AiReferenceRail {...props} className="mx-2.5 mb-2.5" /> : null}
    </div>
  );
}
