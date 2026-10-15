/**
 * Frenz AI prompt suggestions — the shape of one suggestion, and what each workspace can do
 * (owner, 2026-10-15: "Smart video prompt suggestions … help users who don't know how to write
 * AI video prompts generate professional results by selecting a ready-made prompt").
 *
 * The catalog is LOCAL for now (./catalog-text-to-video.ts, ./catalog-image-to-video.ts), loaded
 * only when the library opens. Every field an admin-managed table would need is already here
 * (id, sort order, active, featured, thumbnail, timestamps), so moving the catalog to Supabase
 * later replaces the loader, never the interface. Pure and dependency-light: the workspaces
 * import it.
 */

import { KLING_OMNI_MODEL_NAME } from "@/lib/ai/kling/features/capabilities";

/** The two workspaces — the same names `useVideoGeneration` sends as `feature`. */
export type PromptMode = "text_to_video" | "image_to_video";

/** What the user must attach for the suggestion to do what it says. */
export type RequiredAssets = "none" | "image" | "video" | "image-and-video";

/**
 * What a workspace's model can do with its inputs. Read from the code that runs (below), never
 * assumed: a suggestion naming a capability its workspace lacks is shown as unavailable there.
 */
export type ModelCapability =
  | "text_prompt"
  /** Image to Video: the uploaded photo is the first frame */
  | "first_frame"
  /** reference images keep a face, a character, a product or a place consistent */
  | "reference_images"
  /** a reference video whose scene and motion are KEPT and changed by the prompt ("Edit this video") */
  | "reference_video_edit"
  /** a reference video whose motion and style only are followed ("Copy its motion") */
  | "reference_video_motion";

export interface PromptCategory {
  id: string;
  mode: PromptMode;
  title: string;
  description: string;
  sortOrder: number;
  active: boolean;
}

export interface PromptSuggestion {
  id: string;
  mode: PromptMode;
  /** a PromptCategory id */
  category: string;
  title: string;
  /** one line, shown on the card */
  description: string;
  /** the complete prompt inserted into the field, never truncated */
  prompt: string;
  requiredAssets: RequiredAssets;
  /** the capabilities the prompt relies on — checked against the workspace */
  supportedModelCapabilities: ModelCapability[];
  /** model ids it is written for */
  compatibleModels: string[];
  tags: string[];
  featured: boolean;
  /** inactive suggestions are never shown */
  active: boolean;
  sortOrder: number;
  /** optional picture for the card; none ships yet (no stock images stand in for results) */
  thumbnail: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What each workspace's model really does, from the pipeline code:
 *  · both run Kling v3 Omni (`KLING_OMNI_MODEL_NAME`)
 *  · Text to Video takes reference images and a reference video in either mode
 *    (lib/ai/kling/pipelines/text-to-video.ts: "Edit this video" = base_video, "Copy its motion" = feature_video)
 *  · Image to Video needs the photo as its first frame, takes reference images, and uses a reference video
 *    for its MOTION ONLY (lib/ai/kling/features/image-to-video.ts forces `referenceVideoMode: "feature"`),
 *    so it cannot replace a character inside an existing clip
 */
export const WORKSPACE_CAPABILITIES: Record<PromptMode, { model: string; capabilities: readonly ModelCapability[] }> = {
  text_to_video: {
    model: KLING_OMNI_MODEL_NAME,
    capabilities: ["text_prompt", "reference_images", "reference_video_edit", "reference_video_motion"],
  },
  image_to_video: {
    model: KLING_OMNI_MODEL_NAME,
    capabilities: ["text_prompt", "first_frame", "reference_images", "reference_video_motion"],
  },
};

/** What the workspace currently has attached. */
export interface WorkspaceAssets {
  /** Image to Video's own photo (first frame) */
  firstFrame: boolean;
  referenceImages: number;
  referenceVideo: boolean;
  /** Text to Video's choice for the reference video */
  referenceVideoMode?: "base" | "feature";
}

export type Readiness =
  | { kind: "ready" }
  /** something to attach, in words the notice can use */
  | { kind: "missing"; needs: ("photo" | "reference image" | "reference video")[] }
  /** Text to Video has the video, but set to copy its motion where this prompt edits it */
  | { kind: "switch-to-edit" }
  /** this workspace's model cannot do it; `alternative` can */
  | { kind: "unsupported"; alternative: PromptMode | null };

/** Can this workspace do what the suggestion needs, with what is attached now? */
export function readiness(s: Pick<PromptSuggestion, "requiredAssets" | "supportedModelCapabilities">, mode: PromptMode, assets: WorkspaceAssets): Readiness {
  const caps = WORKSPACE_CAPABILITIES[mode].capabilities;
  if (!s.supportedModelCapabilities.every((c) => caps.includes(c))) {
    const other: PromptMode = mode === "text_to_video" ? "image_to_video" : "text_to_video";
    const alt = s.supportedModelCapabilities.every((c) => WORKSPACE_CAPABILITIES[other].capabilities.includes(c)) ? other : null;
    return { kind: "unsupported", alternative: alt };
  }
  const needs: ("photo" | "reference image" | "reference video")[] = [];
  const wantsImage = s.requiredAssets === "image" || s.requiredAssets === "image-and-video";
  const wantsVideo = s.requiredAssets === "video" || s.requiredAssets === "image-and-video";
  if (wantsImage) {
    // in Image to Video the photo IS the image; in Text to Video it is a reference image
    if (mode === "image_to_video" ? !assets.firstFrame : assets.referenceImages === 0) needs.push(mode === "image_to_video" ? "photo" : "reference image");
  }
  if (wantsVideo && !assets.referenceVideo) needs.push("reference video");
  if (needs.length) return { kind: "missing", needs };
  if (wantsVideo && s.supportedModelCapabilities.includes("reference_video_edit") && mode === "text_to_video" && assets.referenceVideoMode === "feature") {
    return { kind: "switch-to-edit" };
  }
  return { kind: "ready" };
}

/** The short requirement label a card shows. */
export function requirementLabel(s: Pick<PromptSuggestion, "requiredAssets" | "supportedModelCapabilities">, mode: PromptMode): string {
  const video = s.supportedModelCapabilities.includes("reference_video_edit") ? "reference video to edit" : "reference video";
  switch (s.requiredAssets) {
    case "none":
      return mode === "image_to_video" ? "Works with your photo" : "Text only";
    case "image":
      return mode === "image_to_video" ? "Needs your photo" : "Needs a reference image";
    case "video":
      return `Needs a ${video}`;
    case "image-and-video":
      return `Needs a ${video} and a reference image`;
  }
}

/** Insert a suggestion into what is already typed. */
export function combinePrompt(existing: string, suggestion: string, how: "replace" | "append", max: number): string {
  if (how === "replace" || !existing.trim()) return suggestion.slice(0, max);
  const joined = `${existing.replace(/\s+$/, "")}\n\n${suggestion}`;
  return joined.slice(0, max);
}
