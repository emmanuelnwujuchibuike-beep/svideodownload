import type { CharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { modeConfig } from "@/lib/ai/character-replace/config";
import { replacementModeLabel, type ReplacementMode } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceAnyQuality } from "@/lib/ai/character-replace/pricing";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHAT A COMPLIMENTARY CREATION MAY BE — pure rules (Part 11 §5, §21)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The operator's bounds for a free creation, applied to one request: the
 * scope, the quality's rank in that scope's tier list, the length, and the
 * premium voice options. PURE so the same function answers the quote route
 * (a display fact), /start (the decision) and the tests. Nothing here reads a
 * member or a device — eligibility is the server's (free-access.ts); this is
 * only "does THIS video fit the offer".
 */
export interface FreeRequestInput {
  mode: ReplacementMode;
  quality: CharacterReplaceAnyQuality;
  durationMs: number;
  voiceMode: "original" | "new_voice";
  voiceSource: "upload" | "tts" | null;
  lipSyncMode: "standard" | "studio" | null;
}

export type FreeRequestVerdict = { ok: true } | { ok: false; reason: "mode" | "quality" | "duration" | "tts" | "upload" | "lipsync"; message: string };

/** The rank of a quality inside its scope's tier list (0 = the lowest enabled tier). -1 when unknown. */
export function qualityRank(config: CharacterReplaceConfig, mode: ReplacementMode, quality: CharacterReplaceAnyQuality): number {
  return modeConfig(config, mode).tiers.findIndex((t) => t.id === quality);
}

export function freeRequestQualifies(config: CharacterReplaceConfig, input: FreeRequestInput): FreeRequestVerdict {
  const free = config.freeAccess;
  const seconds = free.maxDurationSeconds;
  if (!free.allowedModes.includes(input.mode)) return { ok: false, reason: "mode", message: `${replacementModeLabel(input.mode)} isn't included in complimentary creations.` };
  if (input.durationMs > seconds * 1000) return { ok: false, reason: "duration", message: `Complimentary creations are up to ${seconds} seconds long.` };
  const rank = qualityRank(config, input.mode, input.quality);
  if (rank < 0 || rank > free.maxQualityRank) {
    const cap = modeConfig(config, input.mode).tiers[free.maxQualityRank]?.label ?? modeConfig(config, input.mode).tiers[0]?.label ?? "the lowest quality";
    return { ok: false, reason: "quality", message: `Complimentary creations use ${cap} quality at most.` };
  }
  if (input.voiceMode === "new_voice") {
    if (input.voiceSource === "tts" && !free.allowTts) return { ok: false, reason: "tts", message: "A generated voice isn't included in complimentary creations." };
    if (input.voiceSource === "upload" && !free.allowUploadedVoice) return { ok: false, reason: "upload", message: "Your own audio isn't included in complimentary creations." };
    if (input.lipSyncMode && !free.allowLipSync) return { ok: false, reason: "lipsync", message: "Lip sync isn't included in complimentary creations." };
  }
  return { ok: true };
}

/** The bounds a member is shown, so the interface can say "up to 10 s at Standard" before they choose. Never a decision. */
export function freeAccessLimitsView(config: CharacterReplaceConfig): { maxDurationSeconds: number; maxQualityRank: number; allowedModes: readonly ReplacementMode[]; allowTts: boolean; allowUploadedVoice: boolean; allowLipSync: boolean } {
  const f = config.freeAccess;
  return { maxDurationSeconds: f.maxDurationSeconds, maxQualityRank: f.maxQualityRank, allowedModes: f.allowedModes, allowTts: f.allowTts, allowUploadedVoice: f.allowUploadedVoice, allowLipSync: f.allowLipSync };
}
