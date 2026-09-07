import type { MediaKind } from "@/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the media tools, and what each one honestly needs to run
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07: an AI Studio called "Frenz AI", scoped to MEDIA TOOLS —
 * AI applied to something the member has already saved — and available to
 * SIGNED-IN members only.
 *
 * ── Why a registry rather than a switch in the route ──────────────────────────
 *
 * Each tool differs in three ways that all have to agree: which media it applies
 * to, what INPUT it needs from the client, and whether the thing that powers it
 * is actually configured. Spreading that across a route handler is how a tool
 * ends up offered in the UI and rejected by the server — the shape of half the
 * bugs already fixed on this project. One table, read by both sides.
 *
 * ── 🔴 THE INPUT KIND IS THE HONEST PART ──────────────────────────────────────
 *
 * A saved file lives in the visitor's own IndexedDB, not on our servers, and
 * this product is not about to start uploading people's libraries. So a tool can
 * only run on what the CLIENT can extract and send:
 *
 *   "frames"  — a handful of stills drawn off a <video> into a canvas. Claude
 *               reads images, so this is real vision on a real clip, and the
 *               file itself never leaves the device.
 *   "text"    — a title, description or caption we already hold.
 *   "audio"   — a transcript of the sound. NOTHING CONFIGURED CAN DO THIS.
 *               Claude has no speech-to-text, and no transcription provider is
 *               wired up. Tools that need it are declared here, marked
 *               unavailable, and say so in the UI rather than being hidden —
 *               an owner deciding whether to add a provider key should be able
 *               to see exactly what it would unlock.
 *
 * That last point is the whole reason `requires` exists. It would have been
 * easy to ship "Subtitles" as a button that quietly failed.
 */

/** What the client must supply for a tool to run. */
export type FrenzAiInput = "frames" | "text" | "audio";

export interface FrenzAiTool {
  id: string;
  label: string;
  /** One line, shown under the label — what the member gets, not how it works. */
  blurb: string;
  /** Which saved media this tool makes sense for. */
  appliesTo: readonly MediaKind[];
  requires: FrenzAiInput;
  /**
   * Roughly how much of the daily allowance one run costs.
   *
   * Not all tools are equal: reading four stills is many times the work of
   * rewriting a caption, and charging both as "one use" would let the expensive
   * one hide behind the cheap one in every usage number and every bill.
   */
  cost: number;
}

export const FRENZ_AI_TOOLS: readonly FrenzAiTool[] = [
  {
    id: "summarise",
    label: "Summarise this",
    blurb: "What happens in the clip, in a few lines.",
    appliesTo: ["video"],
    requires: "frames",
    cost: 2,
  },
  {
    id: "describe",
    label: "Describe this image",
    blurb: "A plain description — useful as alt text.",
    appliesTo: ["image"],
    requires: "frames",
    cost: 1,
  },
  {
    id: "caption",
    label: "Write a caption",
    blurb: "A caption you can post, in your own words.",
    appliesTo: ["video", "image"],
    requires: "frames",
    cost: 2,
  },
  {
    id: "translate",
    label: "Translate the title",
    blurb: "The title and description in another language.",
    appliesTo: ["video", "image", "audio"],
    requires: "text",
    cost: 1,
  },
  {
    id: "transcribe",
    label: "Transcribe the audio",
    blurb: "Every word said in the clip, as text.",
    appliesTo: ["video", "audio"],
    requires: "audio",
    cost: 4,
  },
  {
    id: "subtitles",
    label: "Generate subtitles",
    blurb: "A timed .srt file you can save beside the video.",
    appliesTo: ["video"],
    requires: "audio",
    cost: 4,
  },
] as const;

const BY_ID = new Map(FRENZ_AI_TOOLS.map((t) => [t.id, t]));

export function frenzAiTool(id: string): FrenzAiTool | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Which inputs this deployment can actually produce.
 *
 * `frames` and `text` need nothing but a browser. `audio` needs a
 * speech-to-text provider, and there is none — see the note at the top. Passed
 * in rather than read from `process.env` here so this module stays pure and the
 * server decides what it has.
 */
export interface FrenzAiCapabilities {
  /** A vision-capable model is configured (ANTHROPIC_API_KEY). */
  vision: boolean;
  /** A speech-to-text provider is configured. Currently never true. */
  transcription: boolean;
}

/** Whether a tool can run at all right now, and if not, why. */
export function toolAvailability(
  tool: FrenzAiTool,
  caps: FrenzAiCapabilities,
): { available: true } | { available: false; reason: string } {
  if (tool.requires === "audio" && !caps.transcription) {
    return {
      available: false,
      // Said plainly, because the member is not at fault and the owner may be
      // reading it too.
      reason: "Needs a speech-to-text service, which isn't set up yet.",
    };
  }
  if ((tool.requires === "frames" || tool.requires === "text") && !caps.vision) {
    return { available: false, reason: "The AI service isn't configured." };
  }
  return { available: true };
}

/** The tools worth showing for one saved item, in registry order. */
export function toolsForMedia(kind: MediaKind): FrenzAiTool[] {
  return FRENZ_AI_TOOLS.filter((t) => t.appliesTo.includes(kind));
}
