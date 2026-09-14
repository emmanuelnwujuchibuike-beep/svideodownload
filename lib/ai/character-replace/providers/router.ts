import "server-only";

import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import { faceOnlyProvider } from "@/lib/ai/character-replace/providers/face-only";
import { fullCharacterProvider } from "@/lib/ai/character-replace/providers/full-character";
import { skinFaceProvider } from "@/lib/ai/character-replace/providers/skin-face";
import type { ReplacementProvider } from "@/lib/ai/character-replace/providers/types";

/**
 * The replacement router (Skin + Face brief §12):
 *
 *   face_only       → Face Swap Service        → Replicate → xrunda/hello
 *   skin_face       → Identity Transfer Service → Replicate → prunaai/p-video-replace
 *   full_character  → the existing Wan 2.2 Animate Replace service (Parts 4–5)
 *
 * One function, keyed by the mode the ROW carries (never a request). The
 * three adapters share nothing but the interface and the HTTP client.
 */
const PROVIDERS: Record<ReplacementMode, ReplacementProvider> = {
  face_only: faceOnlyProvider,
  skin_face: skinFaceProvider,
  full_character: fullCharacterProvider,
};

export function replacementProviderFor(mode: ReplacementMode): ReplacementProvider {
  return PROVIDERS[mode];
}

/** Whether every replacement mode can run here — one token serves all three. */
export function replacementProvidersConfigured(): boolean {
  return fullCharacterProvider.isConfigured();
}
