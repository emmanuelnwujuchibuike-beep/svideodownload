import type { PlatformId } from "@/types";

/**
 * Learning Academy™ types. See `docs/DOWNLOAD_HUB_RFC.md` §4.
 *
 * This is the one part of the Download Hub brief that needs no product that does
 * not exist yet — it is writing. Lessons are therefore real content, and the
 * Reality Ledger scans this directory: a lesson may teach a technique, but it may
 * not describe an unbuilt Frenz product as something you can use today.
 */

export type LessonTopic =
  | "downloading"
  | "editing"
  | "captions"
  | "quality"
  | "organising"
  | "publishing";

export interface LessonSection {
  heading: string;
  /** Paragraphs. Plain prose — rendered as <p>, no markdown parsing at runtime. */
  body: string[];
  /** Optional ordered steps rendered as a numbered list (and as HowTo JSON-LD). */
  steps?: { title: string; text: string }[];
}

export interface Lesson {
  slug: string;
  title: string;
  /** Meta description; also the card subtitle. Keep under ~158 chars. */
  description: string;
  topic: LessonTopic;
  /** Realistic reading time in minutes. */
  minutes: number;
  /** Platforms this lesson is especially relevant to; empty means all. */
  platformIds: PlatformId[];
  /**
   * Discovery Gateway action ids this lesson supports. The Gateway uses these to
   * attach the right lesson to a completed download.
   */
  relatedActionIds: string[];
  intro: string;
  sections: LessonSection[];
  faqs: { q: string; a: string }[];
  /** Other lesson slugs — the internal-linking graph that builds topical depth. */
  related: string[];
}
