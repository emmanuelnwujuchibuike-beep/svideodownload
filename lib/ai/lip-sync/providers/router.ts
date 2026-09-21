import "server-only";

import { falConfigured } from "@/lib/ai/fal/client";
import { LIP_SYNC_AUDIO_FORMATS, LIP_SYNC_EXPRESSIONS, isAllowedLipSyncModel, lipSyncPriceLine, type LipSyncProConfig, type LipSyncPublicConfig, type LipSyncSpeechSource, type LipSyncVendor } from "@/lib/ai/lip-sync/config";
import { falSync3ProProvider } from "@/lib/ai/lip-sync/providers/fal-sync3";
import { KLING_LIP_SYNC_MODEL, klingLipSyncProvider } from "@/lib/ai/lip-sync/providers/kling-lipsync";
import { syncLabsProProvider } from "@/lib/ai/lip-sync/providers/sync-labs";
import type { LipSyncProProvider } from "@/lib/ai/lip-sync/providers/types";
import type { AiProvidersConfig } from "@/lib/ai/providers/config";
import { textToSpeechProviderFor } from "@/lib/ai/voice/tts-provider";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHICH MODEL RUNS LIP SYNC PRO — configuration first, the SERVER decides
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The operator's `frenzAiLipSync.provider` names the vendor; the vendor's
 * `models[vendor].model` names the adapter. The fal.ai brief's emergency
 * pauses (`frenzAiProviders.paused`) apply here too. The decision is made at
 * /start and written on the row (`provider_plan`); every later step reads
 * the row — never this function again (§21 of the fal.ai brief).
 */
export interface LipSyncRoute {
  vendor: LipSyncVendor;
  adapter: LipSyncProProvider | null;
  configured: boolean;
  paused: boolean;
  enabled: boolean;
  diagnostic: string | null;
}

export function lipSyncAdapterFor(vendor: LipSyncVendor, model: string, providers: AiProvidersConfig): LipSyncProProvider | null {
  if (vendor === "fal") return isAllowedLipSyncModel("fal", model) ? falSync3ProProvider(providers, model) : null;
  if (model === "sync/lipsync-2-pro" || model === "sync/lipsync-2") return syncLabsProProvider(model);
  if (model === KLING_LIP_SYNC_MODEL) return klingLipSyncProvider();
  return null;
}

export function resolveLipSyncProRoute(config: LipSyncProConfig, providers: AiProvidersConfig): LipSyncRoute {
  const vendor = config.provider;
  const choice = config.models[vendor];
  const adapter = lipSyncAdapterFor(vendor, choice.model, providers);
  const paused = providers.paused[vendor];
  const configured = !!adapter && adapter.isConfigured();
  const diagnostic = !adapter
    ? `No adapter serves ${choice.model} on ${vendor}.`
    : !choice.enabled
      ? `The ${vendor} model is disabled in AI → Lip Sync.`
      : paused
        ? `${vendor === "fal" ? "fal.ai" : "Replicate"} is paused (emergency control).`
        : !configured
          ? vendor === "fal"
            ? falConfigured()
              ? "The fal.ai lip-sync model is disabled in the providers configuration."
              : "FAL_KEY is not set on this deployment."
            : "REPLICATE_API_TOKEN (or the model's version pin) is not set on this deployment."
          : null;
  return { vendor, adapter, configured, paused, enabled: choice.enabled, diagnostic };
}

/** §5 / §17: how typed text becomes speech for THIS model. */
export type SpeechPath = "native" | "tts" | "audio";
export function planSpeechPath(source: LipSyncSpeechSource, adapter: LipSyncProProvider | null): SpeechPath {
  if (source === "audio") return "audio";
  return adapter?.capabilities.supports_text ? "native" : "tts";
}

/** Whether the text path can run on this deployment: a native model, or ElevenLabs on the worker. */
export function textPathReady(config: LipSyncProConfig, adapter: LipSyncProProvider | null): boolean {
  if (!config.textMode.enabled) return false;
  if (adapter?.capabilities.supports_text) return true;
  const tts = textToSpeechProviderFor(config.tts.model);
  return tts.runsIn === "worker" && tts.isConfigured();
}

/** The public config: the ACTIVE model's capability flags decide what the interface offers (§12). No vendor or model name leaves. */
export function publicLipSyncConfig(config: LipSyncProConfig, providers: AiProvidersConfig, currency: { code: string; symbol: string }): LipSyncPublicConfig {
  const route = resolveLipSyncProRoute(config, providers);
  const caps = route.adapter?.capabilities ?? {
    supports_text: false,
    supports_audio: false,
    supports_voice_selection: false,
    supports_language: false,
    supports_speed: false,
    supports_active_speaker: false,
    supports_temperature: false,
    supports_duration_control: false,
    video: { minDurationMs: null, maxDurationMs: null, minEdgePx: null, maxEdgePx: null, maxBytes: null },
    audio: { maxBytes: null, containers: [] },
  };
  const usable = !!route.adapter && route.enabled && route.configured && !route.paused;
  const path = planSpeechPath("text", route.adapter);
  const textOk = usable && textPathReady(config, route.adapter);
  const formats = LIP_SYNC_AUDIO_FORMATS.filter((f) => config.audioMode.formats.includes(f.id));
  const maxSeconds = Math.min(config.video.maximumDurationSeconds, caps.video.maxDurationMs ? caps.video.maxDurationMs / 1000 : Infinity);
  const minSeconds = Math.max(config.video.minimumDurationSeconds, caps.video.minDurationMs ? caps.video.minDurationMs / 1000 : 0);
  const choice = config.models[config.provider];
  return {
    enabled: config.enabled && usable,
    currency: currency.code,
    symbol: currency.symbol,
    textMode: { ...config.textMode, enabled: textOk },
    audioMode: { enabled: usable && config.audioMode.enabled && caps.supports_audio, formats, maximumDurationSeconds: config.audioMode.maximumDurationSeconds, maximumUploadBytes: config.audioMode.maximumUploadBytes },
    video: { ...config.video, maximumDurationSeconds: maxSeconds, minimumDurationSeconds: minSeconds, maximumUploadBytes: Math.min(config.video.maximumUploadBytes, caps.video.maxBytes ?? Infinity) },
    capabilities: {
      ...caps,
      // the voice/language/speed controls appear only when they mean something on the path that will run (§12)
      supports_voice_selection: path === "native" ? caps.supports_voice_selection : true,
      supports_language: path === "native" ? caps.supports_language : true,
      supports_speed: path === "native" ? caps.supports_speed : true,
    },
    speechPath: path === "audio" ? "tts" : path,
    expression: { enabled: config.expression.enabled && caps.supports_temperature, default: config.expression.default, options: LIP_SYNC_EXPRESSIONS },
    activeSpeaker: { enabled: config.activeSpeaker.enabled && caps.supports_active_speaker, default: config.activeSpeaker.default },
    duration: { policy: config.duration.policy, significantMismatchFraction: config.duration.significantMismatchFraction },
    priceLine: lipSyncPriceLine(choice.perSecondCents, config.basePriceCents, currency.symbol),
    pricingVersion: config.pricingVersion,
  };
}
