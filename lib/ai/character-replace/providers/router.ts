import "server-only";

import { modeConfig, type CharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { REPLACEMENT_MODES, type ReplacementMode } from "@/lib/ai/character-replace/modes";
import { faceOnlyProvider } from "@/lib/ai/character-replace/providers/face-only";
import { fullCharacterProvider } from "@/lib/ai/character-replace/providers/full-character";
import { skinFaceProvider } from "@/lib/ai/character-replace/providers/skin-face";
import type { ReplacementProvider } from "@/lib/ai/character-replace/providers/types";
import { upperBodyProvider } from "@/lib/ai/character-replace/providers/upper-body";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHICH ADAPTER RUNS A SCOPE — configuration first, code as the fallback
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 6 wired a fixed map (mode → adapter). The replacement-scope brief
 * (2026-09-20, §4, §12) asks for the operator to be able to change the
 * provider/model behind a scope without an interface change, so the router
 * now reads `modes[mode].provider.model` (Full Character: Wan, the top-level
 * integration) and picks the ADAPTER registered for that model that says it
 * supports the scope. Nothing a browser sends reaches this: the model name
 * comes from the settings row the admin writes, and a name no adapter here
 * carries — or one that cannot serve the scope — leaves the scope
 * unavailable rather than routed somewhere surprising.
 *
 * Without a config (a caller that only needs the model NAME, e.g. the
 * circuit-breaker lookup at /start before the row is read) the code default
 * for the scope answers, exactly as Part 6 did.
 */
const ADAPTERS: readonly ReplacementProvider[] = [faceOnlyProvider, skinFaceProvider, fullCharacterProvider, upperBodyProvider];

const DEFAULT_BY_MODE: Record<ReplacementMode, ReplacementProvider> = {
  face_only: faceOnlyProvider,
  skin_face: skinFaceProvider,
  upper_body: upperBodyProvider,
  full_character: fullCharacterProvider,
};

/** The adapters that can serve a scope, for the admin's provider select (model names only reach an operator). */
export function adaptersForMode(mode: ReplacementMode): readonly { model: string; configured: boolean }[] {
  const seen = new Set<string>();
  const out: { model: string; configured: boolean }[] = [];
  for (const a of ADAPTERS) {
    if (!a.supportsMode(mode) || seen.has(a.model)) continue;
    seen.add(a.model);
    out.push({ model: a.model, configured: a.isConfigured() });
  }
  return out;
}

/**
 * The adapter for a scope. With a config, the configured model decides — and
 * an adapter written for the scope wins over a general one that merely
 * supports it (Upper Body on Wan uses the upper-body adapter's tiers, not
 * Full Character's resolutions).
 */
export function replacementProviderFor(mode: ReplacementMode, config?: CharacterReplaceConfig): ReplacementProvider {
  if (!config) return DEFAULT_BY_MODE[mode];
  const model = modeConfig(config, mode).providerModel;
  const candidates = ADAPTERS.filter((a) => a.model === model && a.supportsMode(mode));
  return candidates.find((a) => a.mode === mode) ?? candidates[0] ?? DEFAULT_BY_MODE[mode];
}

/** Whether the configured model for a scope is one an adapter here can serve — the admin's "mode enabled without a provider" warning and the public config's `enabled`. */
export function replacementRouteOk(mode: ReplacementMode, config: CharacterReplaceConfig): boolean {
  const model = modeConfig(config, mode).providerModel;
  return ADAPTERS.some((a) => a.model === model && a.supportsMode(mode));
}

export function replacementProvidersConfigured(): boolean {
  return fullCharacterProvider.isConfigured();
}

/** Every scope's route, for the operator's screen. */
export function replacementRoutes(config: CharacterReplaceConfig): readonly { mode: ReplacementMode; model: string; routed: boolean; configured: boolean }[] {
  return REPLACEMENT_MODES.map((mode) => {
    const model = modeConfig(config, mode).providerModel;
    const adapter = ADAPTERS.find((a) => a.model === model && a.supportsMode(mode));
    return { mode, model, routed: !!adapter, configured: adapter?.isConfigured() ?? false };
  });
}
