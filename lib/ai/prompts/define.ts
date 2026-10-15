import { KLING_OMNI_MODEL_NAME } from "@/lib/ai/kling/features/capabilities";

import type { ModelCapability, PromptCategory, PromptMode, PromptSuggestion, RequiredAssets } from "./schema";

/**
 * Writing the local catalog compactly: each entry states only what is particular to it, and the
 * fields an admin table would carry (capabilities, models, order, timestamps) are filled in the
 * same way for every entry, so they can never disagree with what the entry needs.
 */

export interface Entry {
  slug: string;
  title: string;
  description: string;
  prompt: string;
  tags?: string[];
  needs?: RequiredAssets;
  /** a reference video that is EDITED (its scene and motion kept); otherwise only its motion is followed */
  edit?: boolean;
  featured?: boolean;
}

const RELEASED = "2026-10-15T00:00:00.000Z";

export function category(mode: PromptMode, id: string, title: string, description: string, sortOrder: number): PromptCategory {
  return { id, mode, title, description, sortOrder, active: true };
}

function capabilities(mode: PromptMode, needs: RequiredAssets, edit: boolean): ModelCapability[] {
  const caps: ModelCapability[] = ["text_prompt"];
  if (mode === "image_to_video") caps.push("first_frame");
  const image = needs === "image" || needs === "image-and-video";
  const video = needs === "video" || needs === "image-and-video";
  if (image && mode === "text_to_video") caps.push("reference_images");
  if (video) caps.push(edit ? "reference_video_edit" : "reference_video_motion");
  return caps;
}

/** The entries of one category, in the order given. `base` keeps sort orders unique across categories. */
export function entries(mode: PromptMode, cat: PromptCategory, list: Entry[]): PromptSuggestion[] {
  return list.map((e, i) => {
    const needs = e.needs ?? (mode === "image_to_video" ? "image" : "none");
    return {
      id: `${mode === "text_to_video" ? "t2v" : "i2v"}.${cat.id}.${e.slug}`,
      mode,
      category: cat.id,
      title: e.title,
      description: e.description,
      prompt: e.prompt,
      requiredAssets: needs,
      supportedModelCapabilities: capabilities(mode, needs, !!e.edit),
      compatibleModels: [KLING_OMNI_MODEL_NAME],
      tags: e.tags ?? [],
      featured: !!e.featured,
      active: true,
      sortOrder: cat.sortOrder * 100 + i,
      thumbnail: null,
      createdAt: RELEASED,
      updatedAt: RELEASED,
    };
  });
}
