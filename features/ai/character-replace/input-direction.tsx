"use client";

import { AlertOctagon } from "lucide-react";

import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE DIRECTION — what to upload for a good result, in red, on the input pages
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-14: "Put a clear red bold thick text in the input pages
 * that explains the direction of the exact kind of image and video to use
 * for a perfect result." Said after two days of results that varied with
 * the reference photo far more than with anything in the pipeline: a beach
 * selfie put a beach outfit into a kitchen video (Full Character carries
 * the whole look across), and a different photo of the same video came out
 * better.
 *
 * So the direction is per MODE, because each model wants something
 * different, and it is loud on purpose. It promises "your best chance",
 * never "perfect" — the models are generative and the copy says so.
 */
const PHOTO_DIRECTION: Record<ReplacementMode, { title: string; lines: string[] }> = {
  full_character: {
    title: "For the best Full Character result, upload a FULL-BODY photo",
    lines: [
      "Head to feet in ONE photo, standing, facing the camera, on a plain background.",
      "Wear the clothes you want in the video — the whole look in the photo goes into the video, face, body AND outfit.",
      "NOT a selfie, NOT a face crop, NOT a group photo, NOT sunglasses or a hat.",
      "Good light, sharp, no filters. One person only.",
    ],
  },
  face_only: {
    title: "For the best Face Only result, upload a CLEAR, FRONT-FACING face photo",
    lines: [
      "The face looking straight at the camera, filling most of the frame — a good selfie is ideal.",
      "Even light on the face, no sunglasses, no hat, no hand over the mouth, no heavy filter.",
      "Only the face is used — the body and clothes in the video stay as they are.",
      "One person only. A blurry or tiny face gives a blurry swap.",
    ],
  },
  skin_face: {
    title: "For the best Skin + Face result, upload 1–3 CLEAR photos of the SAME person",
    lines: [
      "Face clearly visible in every photo; different angles (front, three-quarter) help.",
      "Show some neck, arms or shoulders so the skin tone carries across.",
      "The clothes in the video stay — the photos only supply the identity and the skin.",
      "One person only across all the photos. Good light, sharp, no filters.",
    ],
  },
};

const VIDEO_DIRECTION: Record<ReplacementMode, { title: string; lines: string[] }> = {
  full_character: {
    title: "For the best result, use a video where the WHOLE person is clearly visible",
    lines: [
      "ONE person, in frame the whole time, body visible (not only a talking head).",
      "Steady camera, good light, the person not too small and not cut off by the edges.",
      "Avoid fast cuts, mirrors, crowds, heavy motion blur and very dark scenes.",
      "Keep it short — trim to the part that matters. Choose 720p, not 480p, for a clean result.",
    ],
  },
  face_only: {
    title: "For the best result, use a video where the FACE is clearly visible",
    lines: [
      "ONE person, face towards the camera most of the time, well lit and not too small.",
      "Avoid faces turned fully sideways, hands over the face, fast motion blur and heavy shadow.",
      "The video's body, clothes, background and camera stay exactly as they are.",
      "Keep it short — trim to the part that matters.",
    ],
  },
  skin_face: {
    title: "For the best result, use a video where the person and their face are clearly visible",
    lines: [
      "ONE person, face visible most of the time, steady camera, good light.",
      "Clothing, logos and text stay as they are wherever the model can keep them — but it is generative, so small changes can happen.",
      "Avoid crowds, mirrors, fast cuts and very dark scenes.",
      "Keep it short — trim to the part that matters.",
    ],
  },
};

export function CharacterReplaceInputDirection({ kind, mode, className }: { kind: "photo" | "video"; mode: ReplacementMode; className?: string }) {
  const d = (kind === "photo" ? PHOTO_DIRECTION : VIDEO_DIRECTION)[mode];
  return (
    <div role="note" className={cn("rounded-[1.25rem] border-2 border-red-600 bg-red-600/[0.06] px-4 py-3.5 dark:bg-red-500/[0.10]", className)}>
      <p className="flex items-start gap-2 text-[15px] font-black leading-snug tracking-[-0.01em] text-red-600 dark:text-red-400">
        <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden />
        {d.title}
      </p>
      <ul className="mt-2 space-y-1 pl-7 text-[13px] font-bold leading-snug text-red-700 dark:text-red-300">
        {d.lines.map((line) => (
          <li key={line} className="list-disc">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
