import { IMAGE_TO_VIDEO_CATEGORIES, IMAGE_TO_VIDEO_PROMPTS } from "./catalog-image-to-video";
import { TEXT_TO_VIDEO_CATEGORIES, TEXT_TO_VIDEO_PROMPTS } from "./catalog-text-to-video";
import type { PromptCategory, PromptMode, PromptSuggestion } from "./schema";

/**
 * The ONE loader the interface uses. It reads the local catalog today; moving the catalog to
 * Supabase later means changing this function (and keeping its shape), never the library UI.
 * Inactive suggestions and categories are never returned. Loaded with the library (a dynamic
 * import), so none of these strings ride the workspace's first load.
 */
export interface PromptLibraryData {
  categories: PromptCategory[];
  suggestions: PromptSuggestion[];
}

export function loadPromptLibrary(mode: PromptMode): PromptLibraryData {
  const categories = (mode === "text_to_video" ? TEXT_TO_VIDEO_CATEGORIES : IMAGE_TO_VIDEO_CATEGORIES).filter((c) => c.active);
  const live = new Set(categories.map((c) => c.id));
  const suggestions = (mode === "text_to_video" ? TEXT_TO_VIDEO_PROMPTS : IMAGE_TO_VIDEO_PROMPTS)
    .filter((s) => s.active && live.has(s.category))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return { categories: [...categories].sort((a, b) => a.sortOrder - b.sortOrder), suggestions };
}
