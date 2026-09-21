import "server-only";

import type { CharacterReplaceConfig, CharacterReplacePublicMode } from "@/lib/ai/character-replace/config";
import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import { falKlingEditProvider } from "@/lib/ai/character-replace/providers/fal-kling-edit";
import { KLING_O1_EDIT_LIMITS } from "@/lib/ai/character-replace/providers/kling-input";
import { replacementProviderFor, replacementRouteOk } from "@/lib/ai/character-replace/providers/router";
import type { ReplacementProvider } from "@/lib/ai/character-replace/providers/types";
import { falConfigured } from "@/lib/ai/fal/client";
import { elevenLabsConfigured } from "@/lib/ai/voice/elevenlabs";
import { falSync3Provider } from "@/lib/ai/voice/fal-sync3";
import { lipSyncProviderFor, type LipSyncProvider } from "@/lib/ai/voice/lipsync-provider";
import { AI_VENDOR_LABEL, configuredVendor, modelConfigFor, type AiProvidersConfig, type AiVendor, type ProviderFeature, type ProviderModelConfig, type SwitchableVendor } from "@/lib/ai/providers/config";
import { getLandingSettings, type LandingSettings } from "@/lib/landing/settings";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PROVIDER ROUTER — `resolveProvider(feature)`, decided by the SERVER (§9)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "The frontend should not decide the provider. The server decides. Never
 * trust a client-supplied provider value." Nothing here takes a request
 * value: the vendor comes from the settings row the admin writes
 * (`frenzAiProviders`, lib/ai/providers/config.ts), the scope from the job's
 * own metadata, and the adapters from code.
 *
 *   character_replace   replicate → the existing per-scope adapters
 *                                   (providers/router.ts — unchanged)
 *                       fal       → the Kling O1 Video Edit adapter, for the
 *                                   scopes in its capability mapping
 *   lip_sync            replicate → the existing Sync Labs adapters (per tier)
 *                       fal       → the Sync-3 adapter
 *   text_to_speech      elevenlabs, always (§17 — not a branch here at all)
 *   voice_change        elevenlabs, always
 *
 * ── The decision is made ONCE per job, at /start (§21) ──────────────────────
 * `resolveReplacementRoute` runs before the claim and its answer is written
 * on the row (`provider_plan` and the `provider` column). The worker's
 * prepare step, the submit step, the reconciler and the cancel route read
 * the ROW, never this function again — an operator flipping the switch
 * mid-flight changes new jobs only. There is no automatic fallback (§22): a
 * paused or unconfigured vendor refuses the start with a sentence, and a job
 * already running stays where it is.
 *
 * ── The cache ───────────────────────────────────────────────────────────────
 * `getLandingSettings()` is the short controlled cache (10 s per instance;
 * cleared on the instance that saved). Nothing else is cached here.
 */

export interface ReplacementRoute {
  mode: ReplacementMode;
  /** Where a NEW job of this scope goes. */
  vendor: SwitchableVendor;
  adapter: ReplacementProvider | null;
  /** The vendor's model claims the scope. */
  supported: boolean;
  /** Credentials present, the model enabled. */
  configured: boolean;
  /** §26 emergency control: the vendor accepts no new runs. */
  paused: boolean;
  /** The operator's diagnostic when the scope cannot run on the decided vendor. */
  diagnostic: string | null;
  /** The member's sentence for the same. */
  memberMessage: string | null;
  model: string;
  version: string | null;
  /** Limits the vendor's model imposes on top of the tool's own; null = none. */
  limits: { minDurationMs: number | null; maxDurationSeconds: number | null; maxEdgePx: number | null };
  modelConfig: ProviderModelConfig | null;
}

export function resolveReplacementRoute(mode: ReplacementMode, cr: CharacterReplaceConfig, providers: AiProvidersConfig): ReplacementRoute {
  const chosen = providers.features.character_replace.provider;
  if (chosen === "fal") {
    const modelConfig = modelConfigFor(providers, "character_replace", "fal");
    const kling = falKlingEditProvider(modelConfig, providers.features.character_replace.falScopes);
    const supported = kling.supportsMode(mode);
    if (!supported && providers.features.character_replace.unsupportedScopes === "replicate") {
      // The operator's explicit choice: the scopes Kling does not serve stay on the Replicate adapters. Not a fallback — a configured route.
      return replicateRoute(mode, cr, providers, `${scopeLabel(mode)} is not in the fal.ai model's capability mapping; routed to Replicate by the operator's setting.`);
    }
    const paused = providers.paused.fal;
    const configured = kling.isConfigured();
    const limits = { minDurationMs: KLING_O1_EDIT_LIMITS.minDurationMs, maxDurationSeconds: Math.min(KLING_O1_EDIT_LIMITS.maxDurationSecondsForMembers, modelConfig.maxDurationSeconds ?? KLING_O1_EDIT_LIMITS.maxDurationSecondsForMembers), maxEdgePx: Math.min(KLING_O1_EDIT_LIMITS.maxEdgePx, modelConfig.maxEdgePx ?? KLING_O1_EDIT_LIMITS.maxEdgePx) };
    const diagnostic = !supported
      ? `${scopeLabel(mode)} is not in Kling O1 Video Edit's capability mapping (fal.ai). Switch Character Replace back to Replicate, or set "scopes fal.ai cannot serve" to "keep on Replicate".`
      : paused
        ? "fal.ai is paused (emergency control). New Character Replace jobs are refused; nothing is moved to another provider."
        : !configured
          ? falConfigured()
            ? "The fal.ai Character Replace model is disabled in the providers configuration."
            : "FAL_KEY is not set on this deployment, so fal.ai cannot run Character Replace."
          : null;
    const memberMessage = !supported
      ? `${scopeLabel(mode)} isn't available with the current engine. Try another scope, or check back soon — nothing has been charged.`
      : paused || !configured
        ? "Character Replace is temporarily unavailable. Try again in a few minutes — nothing has been charged."
        : null;
    return { mode, vendor: "fal", adapter: supported ? kling : null, supported, configured, paused, diagnostic, memberMessage, model: kling.model, version: kling.version || null, limits, modelConfig };
  }
  return replicateRoute(mode, cr, providers, null);
}

function replicateRoute(mode: ReplacementMode, cr: CharacterReplaceConfig, providers: AiProvidersConfig, note: string | null): ReplacementRoute {
  const adapter = replacementProviderFor(mode, cr);
  const supported = replacementRouteOk(mode, cr);
  const configured = adapter.isConfigured();
  const paused = providers.paused.replicate;
  const diagnostic = !supported
    ? `No Replicate adapter serves ${scopeLabel(mode)} with the model configured on the pricing tab.`
    : paused
      ? "Replicate is paused (emergency control). New Character Replace jobs are refused; nothing is moved to another provider."
      : !configured
        ? "REPLICATE_API_TOKEN is not set on this deployment."
        : note;
  const memberMessage = !supported || paused || !configured ? "Character Replace is temporarily unavailable. Try again in a few minutes — nothing has been charged." : null;
  return { mode, vendor: "replicate", adapter: supported ? adapter : null, supported, configured, paused, diagnostic, memberMessage, model: adapter.model, version: adapter.version || null, limits: { minDurationMs: null, maxDurationSeconds: null, maxEdgePx: null }, modelConfig: null };
}

function scopeLabel(mode: ReplacementMode): string {
  return mode === "face_only" ? "Face Only" : mode === "skin_face" ? "Face + Head" : mode === "upper_body" ? "Upper Body" : "Full Character";
}

export interface LipSyncRoute {
  vendor: SwitchableVendor;
  adapter: LipSyncProvider;
  configured: boolean;
  paused: boolean;
  diagnostic: string | null;
  model: string;
  version: string | null;
  modelConfig: ProviderModelConfig | null;
}

/** The lip-sync adapter for a NEW job: the tier's Replicate model, or Sync-3 on fal.ai. */
export function resolveLipSyncRoute(tierModel: string, providers: AiProvidersConfig): LipSyncRoute {
  if (providers.features.lip_sync.provider === "fal") {
    const modelConfig = modelConfigFor(providers, "lip_sync", "fal");
    const adapter = falSync3Provider(modelConfig);
    const configured = adapter.isConfigured();
    const paused = providers.paused.fal;
    return {
      vendor: "fal",
      adapter,
      configured,
      paused,
      diagnostic: paused ? "fal.ai is paused (emergency control)." : !configured ? (falConfigured() ? "The fal.ai lip-sync model is disabled in the providers configuration." : "FAL_KEY is not set on this deployment.") : null,
      model: adapter.model,
      version: adapter.version || null,
      modelConfig,
    };
  }
  const adapter = lipSyncProviderFor(tierModel);
  const configured = adapter.isConfigured();
  const paused = providers.paused.replicate;
  return { vendor: "replicate", adapter, configured, paused, diagnostic: paused ? "Replicate is paused (emergency control)." : !configured ? `The lip-sync model ${tierModel} is not configured.` : null, model: adapter.model, version: adapter.version || null, modelConfig: null };
}

/** Whether a vendor holds its credentials on THIS deployment. Never the values. */
export function vendorConfigured(vendor: AiVendor): boolean {
  if (vendor === "replicate") return !!process.env.REPLICATE_API_TOKEN?.trim();
  if (vendor === "fal") return falConfigured();
  return elevenLabsConfigured();
}

export interface ProviderResolution {
  feature: ProviderFeature;
  vendor: AiVendor;
  label: string;
  locked: boolean;
  model: string | null;
  configured: boolean;
  paused: boolean;
}

/** `resolveProvider(feature)` — the brief's name for the question, answered from the settings row. */
export async function resolveProvider(feature: ProviderFeature, settings?: LandingSettings): Promise<ProviderResolution> {
  const s = settings ?? (await getLandingSettings());
  const providers = s.frenzAiProviders;
  const vendor = configuredVendor(providers, feature);
  const locked = vendor === "elevenlabs";
  const model =
    feature === "character_replace" || feature === "lip_sync"
      ? vendor === "fal" || vendor === "replicate"
        ? modelConfigFor(providers, feature, vendor).model
        : null
      : feature === "text_to_speech"
        ? s.frenzAiCharacterReplace.tts.model
        : s.frenzAiCharacterReplace.tts.voiceChange.model;
  return {
    feature,
    vendor,
    label: AI_VENDOR_LABEL[vendor],
    locked,
    model,
    configured: vendorConfigured(vendor),
    paused: vendor === "elevenlabs" ? false : providers.paused[vendor],
  };
}

/**
 * Whether Character Replace can run at all under the current routing — the
 * create gate, /start and the public config's `processingAvailable`. True
 * when the decided vendor holds its credentials and is not paused; a scope
 * the vendor cannot serve is a per-scope refusal, not a tool-wide one.
 */
export function characterReplaceProviderReady(settings: LandingSettings): boolean {
  const providers = settings.frenzAiProviders;
  const vendor = providers.features.character_replace.provider;
  if (providers.paused[vendor]) return false;
  if (vendor === "fal") {
    const m = modelConfigFor(providers, "character_replace", "fal");
    if (m.enabled && falConfigured()) return true;
    // the operator kept the unsupported scopes on Replicate — that side can still serve those
    return providers.features.character_replace.unsupportedScopes === "replicate" && vendorConfigured("replicate") && !providers.paused.replicate;
  }
  return vendorConfigured("replicate");
}

/**
 * The public Character Replace config, with the engine behind each scope
 * applied (§4, §5, §29): a scope the decided vendor cannot serve is drawn
 * disabled with its sentence; a scope on Kling carries the 3–10 s window so
 * the trim step guards it before any quote. The vendor's name never leaves
 * the server — only its limits and its sentence do.
 */
export function applyProviderRoutes<T extends { modes: readonly CharacterReplacePublicMode[] }>(publicConfig: T, cr: CharacterReplaceConfig, providers: AiProvidersConfig): T {
  return {
    ...publicConfig,
    modes: publicConfig.modes.map((m) => {
      const route = resolveReplacementRoute(m.id, cr, providers);
      const usable = route.supported && !route.paused && route.configured;
      return {
        ...m,
        enabled: m.enabled && usable,
        ...(m.enabled && !usable ? { unavailableNote: route.memberMessage ?? "Not available right now." } : {}),
        ...(route.limits.maxDurationSeconds ? { maximumDurationSeconds: Math.min(m.maximumDurationSeconds, route.limits.maxDurationSeconds) } : {}),
        ...(route.limits.minDurationMs ? { minimumDurationSeconds: route.limits.minDurationMs / 1000 } : {}),
      };
    }),
  };
}
