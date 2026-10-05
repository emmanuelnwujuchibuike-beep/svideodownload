"use client";

import { AiReferenceRail, type AiReferenceRailProps } from "@/features/ai/video/ai-reference-rail";
import { cn } from "@/lib/utils";

/**
 * The references on Text to Video and Image to Video — image slots AND the
 * reference-video slot, always visible.
 *
 * 🔴 Owner, 2026-10-05: "the text to video and image to video doesn't have a
 * reference Video slot and they are already wired in the backend". They had
 * one — AiReferenceRail's "Add a reference video" (one MP4/MOV, uploaded and
 * priced through the existing route) — but this component first rendered a
 * collapsed "Add Reference · Upload Image" row in front of it, so the video
 * slot was only reachable after opening an IMAGE action. A one-tap "Video"
 * button that opens the picker from an effect is unreliable on iOS Safari
 * (file pickers need the tap's own handler), so the honest fix is to show
 * the rail itself: every slot one tap away, nothing hidden.
 *
 * Nothing is uploaded or fetched until a file is picked.
 */
export function AiReferenceSection(props: AiReferenceRailProps) {
  // the card surface of the redesign instead of the rail's own tinted panel
  return <AiReferenceRail {...props} className={cn("!bg-card !ring-black/[0.07]", props.className)} />;
}
