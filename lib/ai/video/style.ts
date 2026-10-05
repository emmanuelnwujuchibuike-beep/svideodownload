/**
 * The Video Style tiles (redesign page 3, owner's reference 2026-10-05).
 *
 * The model has no style FIELD — it reads the look from the description — so a
 * chosen style is plain words appended to the prompt sent. Nothing is chosen
 * by default, and `withStyle(prompt, null)` is the member's own words exactly,
 * so a member who never touches the tiles sends what they always sent.
 */

export type VideoStyle = "realistic" | "anime" | "cartoon" | "3d";

/** What a chosen style adds to the prompt. */
export const STYLE_WORDS: Record<VideoStyle, string> = {
  realistic: "photorealistic, cinematic live-action style",
  anime: "anime style",
  cartoon: "cartoon animation style",
  "3d": "3D animated film style",
};

/** The prompt as sent: the member's words, then the chosen style — never over the model's limit. */
export function withStyle(prompt: string, style: VideoStyle | null, max: number): string {
  const text = prompt.trim();
  if (!style || !text) return text;
  const suffix = `. ${STYLE_WORDS[style]}.`;
  return `${text.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
}
