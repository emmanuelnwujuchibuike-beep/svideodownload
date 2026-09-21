import "server-only";

import { falCredentialCheck } from "@/lib/ai/fal/client";
import { AI_VENDOR_LABEL, modelConfigFor, type AiProvidersConfig, type AiVendor, type ProviderFeature } from "@/lib/ai/providers/config";
import { openProviderRun } from "@/lib/ai/providers/runs";
import { replicateCall } from "@/lib/ai/replicate/provider";
import { elevenLabsConfigured, elevenLabsListVoices } from "@/lib/ai/voice/elevenlabs";
import { lipSyncProviderFor } from "@/lib/ai/voice/lipsync-provider";
import type { LandingSettings } from "@/lib/landing/settings";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ADMIN "TEST PROVIDER" (the fal.ai brief §27) — never a member's credits
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Validates the CREDENTIALS and the MODEL CONFIGURATION of one vendor for one
 * feature, records the latency and the result as a TEST run in the run ledger
 * (no job, `test = true`), and returns a plain verdict. It submits nothing
 * to a model: a controlled real run costs provider money and is the
 * operator's own decision — done by creating a job in the workspace as an
 * administrator (admins are never charged, and with "admin jobs are tests"
 * on, such a job is flagged TEST everywhere; see start-job.ts).
 *
 *   replicate    GET /v1/account      (the token; the model pins are code)
 *   fal          a status read on an impossible request id — 401/403 = the
 *                key is refused; 404/422 = the key is good and the endpoint
 *                (the configured model) exists
 *   elevenlabs   GET /v1/voices       (the key; the catalogue answers)
 *
 * Nothing here returns a secret or a provider error body to the browser —
 * the verdict is a sentence and a status code.
 */
export interface ProviderTestResult {
  ok: boolean;
  vendor: AiVendor;
  feature: ProviderFeature;
  model: string | null;
  latencyMs: number;
  status: number | null;
  message: string;
  checks: { name: string; ok: boolean; detail: string }[];
}

export async function testProvider(feature: ProviderFeature, vendor: AiVendor, settings: LandingSettings, actorId: string | null): Promise<ProviderTestResult> {
  const providers: AiProvidersConfig = settings.frenzAiProviders;
  const checks: ProviderTestResult["checks"] = [];
  const started = Date.now();
  let model: string | null = null;
  let status: number | null = null;
  let ok = false;

  if (vendor === "fal") {
    if (feature !== "character_replace" && feature !== "lip_sync") {
      return finish({ ok: false, vendor, feature, model: null, latencyMs: 0, status: null, message: `${AI_VENDOR_LABEL[vendor]} is not a provider for this feature (locked to ElevenLabs).`, checks }, actorId);
    }
    const m = modelConfigFor(providers, feature, "fal");
    model = m.model;
    checks.push({ name: "model enabled", ok: m.enabled, detail: m.enabled ? "enabled in the providers configuration" : "disabled — enable it to route jobs here" });
    checks.push({ name: "model id", ok: !!m.model, detail: m.model || "no endpoint configured" });
    const cred = await falCredentialCheck(m.model);
    status = cred.status;
    checks.push({ name: "FAL_KEY", ok: cred.ok, detail: cred.detail });
    ok = cred.ok && m.enabled && !!m.model;
  } else if (vendor === "replicate") {
    if (feature !== "character_replace" && feature !== "lip_sync") {
      return finish({ ok: false, vendor, feature, model: null, latencyMs: 0, status: null, message: `${AI_VENDOR_LABEL[vendor]} is not a provider for this feature (locked to ElevenLabs).`, checks }, actorId);
    }
    const token = !!process.env.REPLICATE_API_TOKEN?.trim();
    checks.push({ name: "REPLICATE_API_TOKEN", ok: token, detail: token ? "present" : "not set on this deployment" });
    if (feature === "lip_sync") {
      const tiers = settings.frenzAiCharacterReplace.lipSync.filter((t) => t.enabled);
      for (const tier of tiers) {
        const adapter = lipSyncProviderFor(tier.model);
        checks.push({ name: `tier ${tier.id} → ${tier.model}`, ok: adapter.isConfigured() || !token, detail: adapter.isConfigured() ? `pinned ${adapter.version.slice(0, 12)}…` : "no adapter or no version pin for this model" });
      }
      model = tiers.map((t) => t.model).join(", ") || null;
    } else {
      model = "per scope (Character Replace pricing tab)";
    }
    if (token) {
      try {
        const res = await replicateCall("/account", { method: "GET", timeoutMs: 10_000 });
        status = res.status;
        checks.push({ name: "api.replicate.com/account", ok: res.ok, detail: res.ok ? "token accepted" : res.status === 401 ? "token refused" : `answered ${res.status}` });
        ok = res.ok && checks.every((c) => c.ok);
      } catch (e) {
        checks.push({ name: "api.replicate.com/account", ok: false, detail: `unreachable: ${String(e).slice(0, 120)}` });
      }
    }
  } else {
    // ElevenLabs — the locked voice provider (§17); tested, never switched.
    const configured = elevenLabsConfigured();
    model = feature === "voice_change" ? settings.frenzAiCharacterReplace.tts.voiceChange.model : settings.frenzAiCharacterReplace.tts.model;
    checks.push({ name: "ELEVENLABS_API_KEY", ok: configured, detail: configured ? "present" : "not set on this deployment" });
    if (configured) {
      try {
        const voices = await elevenLabsListVoices();
        status = 200;
        checks.push({ name: "api.elevenlabs.io/voices", ok: true, detail: `${voices.length} voices on the account` });
        ok = true;
      } catch (e) {
        const detail = String(e);
        status = /\b(401|403)\b/.test(detail) ? 401 : null;
        checks.push({ name: "api.elevenlabs.io/voices", ok: false, detail: status === 401 ? "key refused" : `failed: ${detail.slice(0, 120)}` });
      }
    }
  }

  const latencyMs = Date.now() - started;
  const failed = checks.filter((c) => !c.ok);
  return finish(
    {
      ok,
      vendor,
      feature,
      model,
      latencyMs,
      status,
      message: ok ? `${AI_VENDOR_LABEL[vendor]} answered in ${latencyMs} ms. Credentials and model configuration check out.` : `${AI_VENDOR_LABEL[vendor]}: ${failed.map((c) => `${c.name} — ${c.detail}`).join("; ") || "not ready"}`,
      checks,
    },
    actorId,
  );
}

async function finish(result: ProviderTestResult, actorId: string | null): Promise<ProviderTestResult> {
  // §27: recorded — latency, result, provider — as a TEST run with no job and no member.
  await openProviderRun({
    jobId: null,
    userId: actorId,
    feature: result.feature,
    stage: "test",
    provider: result.vendor,
    model: result.model ?? "",
    providerJobId: null,
    test: true,
    latencyMs: result.latencyMs,
    status: result.ok ? "succeeded" : "failed",
    errorCode: result.ok ? null : "TEST_FAILED",
    errorDetail: result.ok ? null : result.message,
    metadata: { kind: "credential-check", status: result.status, checks: result.checks },
  });
  return result;
}
