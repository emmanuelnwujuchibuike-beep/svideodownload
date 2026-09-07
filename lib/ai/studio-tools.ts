import type { LucideIcon } from "lucide-react";
import { AudioLines, Subtitles, Wand2 } from "lucide-react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the tools the Studio hub offers, and their honest status
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07: Frenz AI is the AI ecosystem inside Frenzsave Studio, and
 * "AI Clean" is its first tool.
 *
 * ── This is NOT a second copy of lib/ai/tools.ts ──────────────────────────────
 *
 * That registry lists the MEDIA TOOLS — things a member runs against one item
 * already saved in their own library, from that item's own surface. This one
 * lists the DESTINATIONS on the Frenz AI hub: tools with a page of their own,
 * that a member walks into and gives a video to. Different input, different
 * surface, different lifecycle. The two `soon` entries below name the media-tool
 * ids they will be powered by, so the relationship is written down rather than
 * discovered later.
 *
 * ── `preview` is a real status, not a soft "live" ─────────────────────────────
 *
 * AI Clean's INTERFACE ships in this part; the cleanup itself does not exist
 * yet — no model, no pipeline, no job. The hub therefore opens it and says so
 * on the page rather than pretending, and nothing here claims a capability the
 * repo cannot point at. That is the constitution's truth rule (docs/CONSTITUTION.md,
 * Article I.3) applied to a product surface: `status` is the one field a future
 * reader will trust, so it may never be optimistic.
 */

export type FrenzAiToolStatus =
  /** The tool has a page a member can open today. What it can DO may still be landing. */
  | "preview"
  /** Declared, not built. No link — a card that goes nowhere is worse than no card. */
  | "soon";

export interface FrenzAiStudioTool {
  id: string;
  name: string;
  /** One line, in the member's terms — what they get, never how it works. */
  blurb: string;
  icon: LucideIcon;
  /** The destination. `null` for everything not built, enforced by the tests. */
  href: string | null;
  status: FrenzAiToolStatus;
  /** Whether the finished tool is a Pro feature. */
  pro: boolean;
  /** What is missing, in plain words. Required for anything not fully live. */
  note: string;
}

export const FRENZ_AI_STUDIO_TOOLS: readonly FrenzAiStudioTool[] = [
  {
    id: "clean",
    name: "AI Clean",
    blurb: "Remove unwanted captions, subtitles and text from your videos.",
    icon: Wand2,
    href: "/studio/ai/clean",
    status: "preview",
    pro: true,
    note: "Part 1 shipped the interface only: a video can be chosen and previewed, and nothing is uploaded or processed. The detection and inpainting pipeline is a later part.",
  },
  {
    id: "subtitles",
    name: "Subtitles",
    blurb: "Turn what is said in a clip into subtitles you can save beside it.",
    icon: Subtitles,
    href: null,
    status: "soon",
    pro: true,
    note: "Blocked on speech-to-text, exactly as the media-tool registry records for `subtitles` (lib/ai/tools.ts): Claude has no audio input and no transcription provider is configured.",
  },
  {
    id: "transcribe",
    name: "Transcribe",
    blurb: "Every word from a clip, as text you can copy.",
    icon: AudioLines,
    href: null,
    status: "soon",
    pro: true,
    note: "Same gap as Subtitles — the media-tool registry marks `transcribe` unavailable for want of a speech-to-text service.",
  },
];

export function frenzAiStudioTool(id: string): FrenzAiStudioTool | null {
  return FRENZ_AI_STUDIO_TOOLS.find((t) => t.id === id) ?? null;
}

/** Tools a member can actually open, in declaration order. */
export function openableFrenzAiTools(): FrenzAiStudioTool[] {
  return FRENZ_AI_STUDIO_TOOLS.filter((t) => t.href !== null);
}
