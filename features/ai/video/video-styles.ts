import type { AiStyleOption } from "@/features/ai/design/ai-generate";
import type { VideoStyle } from "@/lib/ai/video/style";

/**
 * The Video Style tiles for BOTH video tools (owner, 2026-10-05: "use this
 * image for the 3D button in the text to video and image to video"). The
 * pictures are the owner's own; the realistic one is from the curated
 * wallpaper library. 264×152 webp in /public/ai/styles, 5–11 kB each.
 */
export const VIDEO_STYLES: readonly AiStyleOption<VideoStyle>[] = [
  { value: "realistic", label: "Realistic", image: "/ai/styles/realistic.webp" },
  { value: "anime", label: "Anime", image: "/ai/styles/anime.webp" },
  { value: "cartoon", label: "Cartoon", image: "/ai/styles/cartoon.webp" },
  { value: "3d", label: "3D", image: "/ai/styles/3d.webp" },
];
