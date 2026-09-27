import "server-only";

import { after } from "next/server";

import { policyBlockEvent, screenAiText } from "@/lib/ai/acceptable-use";
import { providerHealthFor } from "@/lib/ai/character-replace/circuit";
import { concurrencyLimitFor } from "@/lib/ai/character-replace/config";
import { LAUNCH_INTERNAL_MESSAGE, launchAllows } from "@/lib/ai/character-replace/launch-server";
import { getCharacterReplaceBalanceCents, reserveCharacterReplaceCharge } from "@/lib/ai/character-replace/wallet";
import { creditDecisionView, decideCredits, getAiCreditEntitlement, type CreditDecision } from "@/lib/ai/credits/entitlement";
import { currentPeriods, reserveAiCredits } from "@/lib/ai/credits/store";
import type { AiEntitlement } from "@/lib/ai/entitlement";
import type { AiErrorCode } from "@/lib/ai/errors";
import { releaseJobFunding } from "@/lib/ai/funding";
import { recordJobEvent } from "@/lib/ai/job-events";
import { claimJobStart, createJob, findJobByRequestId, getOwnJob, revertJobStartClaim, transitionJob } from "@/lib/ai/job-store";
import { aiFeature, type AiJobRow } from "@/lib/ai/jobs";
import { openProviderRun } from "@/lib/ai/providers/runs";
import { subjectOwnerId, type AiSubject } from "@/lib/ai/subject";
import { catalogueProviderForRoute, resolveTextToAudioRoute, routeAllowsClones, type TextToAudioResolvedRoute } from "@/lib/ai/text-to-audio/route";
import { touchVoiceClone } from "@/lib/ai/voice-clone/clones";
import { cloneIdFromVoiceId, isCloneVoiceId } from "@/lib/ai/voice-clone/usable";
import { finalizeTextToAudioJob, runDirectTextToAudio } from "@/lib/ai/text-to-audio/finalize";
import { consumeFreeCharacters, readFreeCharacters } from "@/lib/ai/text-to-audio/free";
import { defaultAudioName } from "@/lib/ai/text-to-audio/job-meta";
import { countTextToAudioCharacters, publicTextToAudioQuote, quoteTextToAudio, textToAudioCredits, textToAudioMonthKey, type TextToAudioQuote } from "@/lib/ai/text-to-audio/pricing";
import type { CreateTextToAudioJobRequest } from "@/lib/ai/text-to-audio/schemas";
import { elevenLabsTtsModel } from "@/lib/ai/voice/elevenlabs-models";
import { voiceSettingsForDelivery, type TtsDelivery } from "@/lib/ai/voice/voice-settings";
import { getLandingSettings, type LandingSettings } from "@/lib/landing/settings";
import { SITE_URL } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  GENERATE — one request: verify, price, fund, submit (Text to Audio)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The brief: "text → ElevenLabs v3 → audio → preview → download → save to
 * the Audio Library … its own billing … never a video pipeline." There is
 * nothing to upload, so there is no draft step: ONE call carries the text and
 * comes back with a job that is already funded and running. The sequence is
 * the video tools' /start, in the same order and with the same functions:
 *
 *   A · gate       the tool switch, the member's entitlement, the studio's
 *                  kill switches (launch mode, maintenance, processing pause)
 *   R · route      the admin switch: Replicate ElevenLabs v3 | the direct API
 *                  — decided ONCE and written on the row; no fall-through
 *   V · validate   the text within the operator's and the model's ceilings,
 *                  the acceptable-use screen, the voice and language resolved
 *                  SERVER-SIDE against the catalogue (a provider voice id is
 *                  never taken from the browser)
 *   F · free       this month's free characters TAKEN first (atomic per
 *                  member), the quote made from what was actually covered
 *   $ · price      recomputed here; a difference from what the member was
 *                  shown is refused as PRICE_CHANGED with the fresh quote
 *   B · fund       included credits → the wallet (nothing when fully free);
 *                  the claim under the concurrency lock, then the reservation,
 *                  a revert on refusal (and the free characters given back)
 *   S · submit     replicate: the prediction now, the webhook finishes it;
 *                  elevenlabs: the synthesis right after the response
 *                  (`after()`), stored and settled by the same finalizer
 *
 * Idempotent on `clientRequestId`: a retry of the same request finds the
 * same job and charges nothing twice (the unique index, then `claimJobStart`'s
 * compare-and-set).
 */
export interface TextToAudioShared {
  settings: LandingSettings;
  entitlement: AiEntitlement;
  isAdmin: boolean;
}
export type TextToAudioGenerateOutcome =
  | { ok: true; job: AiJobRow; created: boolean; billing: "free" | "credits" | "paid" | null; balanceCents: number | null; credits: ReturnType<typeof creditDecisionView> | null; freeCharactersUsed: number }
  | { ok: false; code: AiErrorCode; extra?: Record<string, unknown> };

const refuse = (code: AiErrorCode, extra?: Record<string, unknown>): TextToAudioGenerateOutcome => ({ ok: false, code, extra });
const UNAVAILABLE = "Text to Audio is temporarily unavailable. Try again in a few minutes — nothing has been charged.";

export interface TextToAudioGate {
  ok: boolean;
  code?: AiErrorCode;
  extra?: Record<string, unknown>;
  resolved: TextToAudioResolvedRoute;
}

/** The switches, in the order every paid AI tool checks them. */
export async function textToAudioGate(shared: Pick<TextToAudioShared, "settings" | "entitlement">, subject: AiSubject): Promise<TextToAudioGate> {
  const { settings, entitlement } = shared;
  const config = settings.frenzAiTextToAudio;
  const cr = settings.frenzAiCharacterReplace;
  const resolved = resolveTextToAudioRoute(config);
  if (!config.enabled || !entitlement.allowed) return { ok: false, code: "FEATURE_UNAVAILABLE", resolved };
  if (!(await launchAllows(cr, subject))) return { ok: false, code: "FEATURE_UNAVAILABLE", extra: { error: LAUNCH_INTERNAL_MESSAGE }, resolved };
  if (cr.ops.maintenanceMode) return { ok: false, code: "CR_MAINTENANCE", extra: { error: cr.ops.maintenanceMessage }, resolved };
  if (!cr.ops.processingEnabled) return { ok: false, code: "CR_BUSY", resolved };
  if (!resolved.enabled || !resolved.configured) return { ok: false, code: "PROVIDER_UNAVAILABLE", extra: { error: UNAVAILABLE }, resolved };
  return { ok: true, resolved };
}

/** The model's own ceiling on one request (the direct API's spec); the Replicate model shares v3's 5,000. */
export function modelCharacterCeiling(model: string): number {
  return elevenLabsTtsModel(model)?.maxCharacters ?? 5_000;
}

export async function generateTextToAudio(input: { subject: AiSubject & { kind: "user" }; request: Request; body: CreateTextToAudioJobRequest; shared: TextToAudioShared }): Promise<TextToAudioGenerateOutcome> {
  const feature = aiFeature("ai_text_to_audio");
  if (!feature) return refuse("FEATURE_UNAVAILABLE");
  const { subject, body, shared } = input;
  const { settings, entitlement } = shared;
  const config = settings.frenzAiTextToAudio;
  const cr = settings.frenzAiCharacterReplace;
  const plans = settings.frenzAiPlans;
  const ownerId = subjectOwnerId(subject);

  /* ── the same request again: the same job, nothing charged twice ───────── */
  const existing = await findJobByRequestId(subject, body.clientRequestId);
  if (existing) return { ok: true, job: existing, created: false, billing: null, balanceCents: null, credits: null, freeCharactersUsed: 0 };

  /* ── A · gate · R · route ──────────────────────────────────────────────── */
  const gate = await textToAudioGate(shared, subject);
  if (!gate.ok) return refuse(gate.code!, gate.extra);
  const resolved = gate.resolved;

  /* ── V · validate ──────────────────────────────────────────────────────── */
  const text = body.text.trim();
  const characters = countTextToAudioCharacters(text);
  if (characters < config.minimumCharacters) return refuse("INVALID_INPUT", { error: "Type what you'd like to hear." });
  const ceiling = Math.min(config.maximumCharacters, modelCharacterCeiling(resolved.model));
  if (characters > ceiling) return refuse("INVALID_INPUT", { error: `Keep the text to ${ceiling.toLocaleString("en-US")} characters.`, limit: "too_long", maximumCharacters: ceiling });
  const policy = screenAiText(body.name ?? null, text);
  if (!policy.allowed) {
    console.info("[tta/generate] policy block", policyBlockEvent(policy.reason, subject.key));
    return refuse("POLICY_BLOCKED");
  }
  /*
    ── 2026-09-27 · the member's own voice ───────────────────────────────────
    A `clone:<uuid>` id is looked up in THEIR library, scoped by their user id
    (lib/ai/voice-clone/usable.ts explains why the prefix is a boundary rather
    than a convenience). Somebody else's clone, a half-made one and a deleted
    one all answer as no voice at all — and the Replicate route refuses the
    idea outright, because a clone has no name in its fixed enum.
  */
  let clone: { id: string; name: string; providerVoiceId: string } | null = null;
  if (isCloneVoiceId(body.voiceId)) {
    if (!routeAllowsClones(resolved.route)) return refuse("INVALID_INPUT", { error: "Your own voices aren't available right now. Choose one of the voices offered." });
    if (!settings.frenzAiVoiceClone.enabled) return refuse("INVALID_INPUT", { error: "Your own voices aren't available right now. Choose one of the voices offered." });
    const id = cloneIdFromVoiceId(body.voiceId!);
    const { resolveOwnClone } = await import("@/lib/ai/voice-clone/clones");
    const row = id ? await resolveOwnClone(ownerId, id) : null;
    if (!row) return refuse("INVALID_INPUT", { error: "That voice isn't in your library any more. Choose another." });
    clone = { id: row.id, name: row.name, providerVoiceId: row.provider_voice_id };
  }
  // the voice and the language, from the catalogue only (§ "never trusted from the browser")
  const catalogueProvider = catalogueProviderForRoute(resolved.route);
  const voice = !clone && body.voiceId ? cr.voices.find((v) => v.id === body.voiceId && v.provider === catalogueProvider) : null;
  if (!clone && body.voiceId && !voice) return refuse("INVALID_INPUT", { error: "Choose one of the voices offered." });
  if (voice && config.voiceIds.length && !config.voiceIds.includes(voice.id)) return refuse("INVALID_INPUT", { error: "Choose one of the voices offered." });
  if (!clone && !voice) {
    // the Replicate model needs a voice NAME and the direct API a voice id — neither has a "default" this product sends blind
    const first = cr.voices.find((v) => v.provider === catalogueProvider && (!config.voiceIds.length || config.voiceIds.includes(v.id)));
    if (!first) return refuse("FEATURE_UNAVAILABLE", { error: "No voice is set up for this tool yet." });
    return refuse("INVALID_INPUT", { error: "Choose a voice.", voiceRequired: true, suggestedVoiceId: first.id });
  }
  const language = (body.languageCode ?? voice?.languages[0] ?? "en").toLowerCase();
  if (!resolved.provider.supportedLanguages().includes(language)) return refuse("INVALID_INPUT", { error: "That language isn't offered right now." });
  // a clone is not limited to one language: the model speaks it in every language it knows
  if (voice && voice.languages.length && !voice.languages.includes(language)) return refuse("INVALID_INPUT", { error: "That voice doesn't speak that language." });
  if (config.languageCodes.length && !config.languageCodes.includes(language)) return refuse("INVALID_INPUT", { error: "That language isn't offered right now." });
  const name = (body.name ?? defaultAudioName(text)).slice(0, 120);
  /*
    2026-09-27: HOW it is spoken. The member names a delivery; the numbers are
    the operator's, resolved here and written on the row, so the audio and the
    record agree. With the choice switched off the operator's default applies
    to everyone — a browser cannot opt into a delivery that is not offered.
  */
  const delivery: TtsDelivery = (config.deliveryChoice ? (body.delivery ?? config.defaultDelivery) : config.defaultDelivery) as TtsDelivery;
  const voiceSettings = voiceSettingsForDelivery(config.voiceSettings, delivery);

  /* ── the breaker, before any money moves ──────────────────────────────── */
  if (cr.ops.circuitBreaker.enabled) {
    const { open } = await providerHealthFor([resolved.model]);
    if (open.length > 0) return refuse("PROVIDER_UNAVAILABLE", { error: UNAVAILABLE });
  }

  /* ── F · the month's free characters, taken first ─────────────────────── */
  const monthKey = textToAudioMonthKey(new Date(), plans.reset.timezone);
  const allowance = config.freeCharactersPerMonth;
  const before = await readFreeCharacters(ownerId, monthKey, allowance);
  const shown = quoteTextToAudio({ characters, freeCharactersAvailable: before.remaining }, config, { currency: settings.frenzAiCurrency });
  // the member was shown a price; if today's price for this text differs, they see the new one before anything is taken
  if (body.quote && (body.quote.totalCents !== shown.totalCents || body.quote.pricingConfigVersion !== shown.pricingConfigVersion)) {
    return refuse("PRICE_CHANGED", { quote: publicTextToAudioQuote(shown) });
  }
  const taken = await consumeFreeCharacters(ownerId, monthKey, characters, allowance);
  if (!taken) return refuse("INTERNAL_ERROR");
  const giveBack = async (why: string) => {
    if (taken.covered > 0) await createAdminClient().rpc("release_tta_free_characters", { p_user_id: ownerId, p_month_key: monthKey, p_characters: taken.covered }).then(({ error }) => error && console.error("[tta/generate] free release failed", { userId: ownerId, why, message: error.message }));
  };
  const quote: TextToAudioQuote = taken.covered === shown.freeCharactersCovered ? shown : quoteTextToAudio({ characters, freeCharactersAvailable: taken.covered }, config, { currency: settings.frenzAiCurrency });
  if (quote.totalCents !== shown.totalCents) {
    // a concurrent generation took the last free characters between the read and the take: the price moved, the member decides
    await giveBack("price moved");
    return refuse("PRICE_CHANGED", { quote: publicTextToAudioQuote(quote) });
  }

  /* ── B · fund: credits → the wallet; nothing when fully free ──────────── */
  const free = quote.totalCents === 0;
  let creditDecision: CreditDecision | null = null;
  let useCredits = false;
  if (!free && plans.enabled) {
    const creditEntitlement = await getAiCreditEntitlement(ownerId, plans);
    if (creditEntitlement.plan) {
      const estimate = textToAudioCredits(quote, config, plans);
      creditDecision = decideCredits(creditEntitlement, { feature: feature.id, priceCents: estimate.priceCents, mode: "text_to_audio", durationMs: null, lines: quote.lines.filter((l) => l.amountCents > 0).map((l) => ({ label: l.label, cents: l.amountCents })) }, plans);
      const wantsWallet = body.funding === "wallet";
      if (creditDecision.affordable && !wantsWallet) useCredits = true;
      else if (!wantsWallet && plans.walletFallback !== "allow") {
        await giveBack("credits required");
        return refuse("CR_CREDITS_REQUIRED", { credits: creditDecisionView(creditDecision), walletFallback: plans.walletFallback, priceCents: quote.totalCents, currency: quote.currency });
      } else if (wantsWallet && plans.walletFallback === "off") {
        await giveBack("wallet off");
        return refuse("CR_CREDITS_REQUIRED", { credits: creditDecisionView(creditDecision), walletFallback: plans.walletFallback, priceCents: quote.totalCents, currency: quote.currency });
      }
    }
  }
  const balanceBefore = free || useCredits ? null : await getCharacterReplaceBalanceCents(ownerId).catch(() => null);
  if (!free && !useCredits) {
    if (balanceBefore === null) {
      await giveBack("balance read failed");
      return refuse("INTERNAL_ERROR");
    }
    if (balanceBefore < quote.totalCents) {
      await giveBack("balance short");
      return refuse("CR_BALANCE_REQUIRED", { balanceCents: balanceBefore, requiredCents: quote.totalCents, shortfallCents: quote.totalCents - balanceBefore, currency: quote.currency, ...(creditDecision ? { credits: creditDecisionView(creditDecision) } : {}) });
    }
  }

  /* ── the row ───────────────────────────────────────────────────────────── */
  const created = await createJob({ subject, feature, source: { kind: "upload", size: characters, mimeType: "text/plain", name }, clientRequestId: body.clientRequestId });
  if (!created.created) {
    await giveBack("duplicate request");
    return { ok: true, job: created.row, created: false, billing: null, balanceCents: null, credits: null, freeCharactersUsed: 0 };
  }
  const job = created.row;
  const now = new Date().toISOString();
  const metadata = {
    ...(job.metadata ?? {}),
    tool: "text_to_audio",
    // the brief §9: one tool id per OPERATION, stored so billing and analytics can group without re-deriving it
    tool_id: "text_to_audio",
    text,
    characters,
    name,
    save: body.save !== false,
    voiceId: clone ? body.voiceId! : voice!.id,
    providerVoiceId: clone ? clone.providerVoiceId : voice!.providerVoiceId || null,
    clone_id: clone?.id ?? null,
    languageCode: language,
    delivery,
    voice_settings: voiceSettings,
    route: resolved.route,
    model: resolved.model,
    quote,
    quote_id: null,
    billing: free
      ? { type: "FREE_ALLOWANCE", normalPriceCents: quote.totalCents, chargedCents: 0, currency: quote.currency }
      : useCredits && creditDecision
        ? { type: "CREDITS", normalPriceCents: quote.totalCents, chargedCents: 0, currency: quote.currency, credits: creditDecision.estimate.creditsRequired, plan: creditDecision.plan, creditsConfigVersion: creditDecision.estimate.configVersion }
        : { type: "PAID", normalPriceCents: quote.totalCents, chargedCents: quote.totalCents, currency: quote.currency },
    free_characters: { monthKey, covered: taken.covered },
    provider_plan: { id: resolved.route === "replicate" ? "replicate" : "elevenlabs", model: resolved.model, version: resolved.provider.version || null, scope: "text_to_audio", providersVersion: settings.frenzAiProviders.version, decidedAt: now, test: shared.isAdmin && settings.frenzAiProviders.adminJobsAreTests },
    provider_cost_estimate: quote.providerCostEstimateUsdCents !== null ? { totalUsdCents: quote.providerCostEstimateUsdCents, ttsUsdCents: quote.providerCostEstimateUsdCents } : null,
    // the Replicate route is a one-stage pipeline (`voice` → finalize) so the webhook handler, the reconciler and the recovery pass read it as they read every job
    pipeline: resolved.route === "replicate" ? { stages: ["voice", "finalize"], current: "voice", records: { voice: { status: "pending" } }, stage_started_at: now, pending_advance: null } : null,
    output: null,
    asset_id: null,
    consent_at: now,
    audience: shared.isAdmin ? "admin" : entitlement.audience,
  };

  const maxActive = concurrencyLimitFor(cr, { audience: entitlement.audience, isAdmin: shared.isAdmin, policyMaxConcurrent: entitlement.maxConcurrent });
  const claim = await claimJobStart({
    jobId: job.id,
    userId: ownerId,
    feature: feature.id,
    // audio is quick and small: a member may run a few alongside a video
    maxActivePerUser: Math.max(2, maxActive),
    maxActiveGlobal: cr.limits.maxActiveJobsGlobal,
    maxPerDay: cr.limits.maxJobsPerUserPerDay,
    chargedCents: free || useCredits ? 0 : quote.totalCents,
    metadata,
    funding: free ? "free" : useCredits ? "credits" : "balance",
    queue: false,
  });
  const endUnclaimed = async (why: string) => {
    await giveBack(why);
    await transitionJob(job.id, ["queued"], "cancelled", { completed_at: new Date().toISOString(), error_code: null });
  };
  if (claim === "user_limit" || claim === "waiting") {
    await endUnclaimed("active limit");
    return refuse("CR_ACTIVE_LIMIT");
  }
  if (claim === "daily_limit") {
    await endUnclaimed("daily limit");
    return refuse("CR_DAILY_LIMIT");
  }
  if (claim === "global_limit") {
    await endUnclaimed("global limit");
    return refuse("CR_BUSY");
  }
  const claimed = claim === "claimed" ? await getOwnJob(subject, job.id) : null;
  if (!claimed || claimed.status !== "acquiring") {
    const fresh = claimed ?? (await getOwnJob(subject, job.id));
    return { ok: true, job: fresh ?? job, created: true, billing: null, balanceCents: null, credits: null, freeCharactersUsed: 0 };
  }

  /* ── reserve ───────────────────────────────────────────────────────────── */
  const ledgerSnapshot = { ...quote, product: "text_to_audio", mode: "text_to_audio", quality: quote.model, provider: resolved.route === "replicate" ? "replicate" : "elevenlabs", providerModel: resolved.model, durationMs: 0, freeCharactersCovered: taken.covered };
  let balanceAfter: number | null = balanceBefore;
  if (useCredits && creditDecision && creditDecision.plan) {
    const reservation = await reserveAiCredits({ userId: ownerId, jobId: job.id, feature: feature.id, plan: creditDecision.plan, estimate: creditDecision.estimate, dailyLimit: creditDecision.dailyLimit, weeklyLimit: creditDecision.weeklyLimit, periods: currentPeriods(plans), config: plans }).catch(() => null);
    if (!reservation || !reservation.ok) {
      await revertJobStartClaim(job.id, job.metadata ?? {});
      await endUnclaimed("credits reservation refused");
      return refuse("CR_CREDITS_UNAVAILABLE", reservation && !reservation.ok ? { reason: reservation.reason } : undefined);
    }
  } else if (!free) {
    try {
      balanceAfter = await reserveCharacterReplaceCharge({ userId: ownerId, jobId: job.id, snapshot: ledgerSnapshot as unknown as Parameters<typeof reserveCharacterReplaceCharge>[0]["snapshot"] });
    } catch (e) {
      await revertJobStartClaim(job.id, job.metadata ?? {});
      await endUnclaimed("wallet reservation refused");
      const msg = String(e);
      if (/insufficient/i.test(msg)) return refuse("CR_BALANCE_REQUIRED", { balanceCents: balanceBefore, requiredCents: quote.totalCents, shortfallCents: Math.max(0, quote.totalCents - (balanceBefore ?? 0)), currency: quote.currency });
      console.error("[tta/generate] reserve threw", { jobId: job.id, error: msg.slice(0, 200) });
      return refuse("INTERNAL_ERROR");
    }
  }

  /* ── S · submit ────────────────────────────────────────────────────────── */
  const billing = free ? "free" : useCredits ? "credits" : "paid";
  const submitted = await submitTextToAudio(claimed, resolved, { origin: new URL(input.request.url).origin });
  if (!submitted.ok) {
    // nothing ran: the funding comes back (the row's own free characters through the same undo), the job ends here
    await releaseJobFunding({ job: claimed, subject, feature: feature.id, dailyLimit: 0, cause: "undo" });
    await transitionJob(job.id, ["acquiring", "processing"], "failed", { error_code: submitted.code, error_message: submitted.detail.slice(0, 2000), completed_at: new Date().toISOString() });
    await recordJobEvent(job.id, "provider.refused", { route: resolved.route, model: resolved.model, reason: submitted.detail.slice(0, 300), feature: feature.id });
    console.error("[tta/generate] submit failed", { jobId: job.id, route: resolved.route, code: submitted.code, detail: submitted.detail.slice(0, 300) });
    return refuse(submitted.code === "FEATURE_UNAVAILABLE" ? "FEATURE_UNAVAILABLE" : "PROVIDER_UNAVAILABLE", { error: UNAVAILABLE });
  }
  // "last used" in the Voice Library, and the operator's view of which slots are dead weight. Never able to fail a generation.
  if (clone) void touchVoiceClone(clone.id).catch(() => null);
  console.info("[tta/generate] funded and submitted", { jobId: job.id, userId: ownerId, route: resolved.route, model: resolved.model, characters, freeCovered: taken.covered, ownVoice: !!clone, chargedCents: free || useCredits ? 0 : quote.totalCents, billing, credits: creditDecision?.estimate.creditsRequired ?? null });
  const fresh = (await getOwnJob(subject, job.id)) ?? claimed;
  return { ok: true, job: fresh, created: true, billing, balanceCents: balanceAfter, credits: creditDecision ? creditDecisionView(creditDecision) : null, freeCharactersUsed: taken.covered };
}

/**
 * The provider step by route. `replicate`: the prediction is created in the
 * request (a quick call) and the row moves to `processing` with its id — the
 * webhook, the reconciler and the recovery pass finish it. `elevenlabs`: the
 * row moves to `processing` and the synthesis runs after the response; the
 * member's poll sees it complete a few seconds later.
 */
async function submitTextToAudio(job: AiJobRow, resolved: TextToAudioResolvedRoute, opts: { origin: string }): Promise<{ ok: true } | { ok: false; code: "PROVIDER_ERROR" | "FEATURE_UNAVAILABLE" | "INTERNAL_ERROR"; detail: string }> {
  const meta = job.metadata ?? {};
  const text = typeof meta.text === "string" ? meta.text : "";
  const providerVoiceId = typeof meta.providerVoiceId === "string" ? meta.providerVoiceId : null;
  const languageCode = typeof meta.languageCode === "string" ? meta.languageCode : "en";
  const voiceSettings = readVoiceSettings(meta.voice_settings);
  const test = (meta.provider_plan as { test?: unknown } | null)?.test === true;
  const startedAt = Date.now();
  if (resolved.route === "replicate") {
    const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? SITE_URL ?? opts.origin).replace(/\/$/, "");
    let sub: Awaited<ReturnType<typeof resolved.provider.createPrediction>>;
    try {
      sub = await resolved.provider.createPrediction({ jobId: job.id, text, languageCode, providerVoiceId, voiceSettings, webhookUrl: `${origin}/api/ai/replicate/webhook` });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return { ok: false, code: /not configured|no text-to-speech adapter/i.test(detail) ? "FEATURE_UNAVAILABLE" : "PROVIDER_ERROR", detail };
    }
    const pipeline = { stages: ["voice", "finalize"], current: "voice", records: { voice: { status: "submitted", predictionId: sub.reference, provider: { id: "replicate", model: sub.model, version: sub.modelVersion }, submittedAt: new Date().toISOString() } }, stage_started_at: new Date().toISOString(), pending_advance: null };
    const moved = await transitionJob(job.id, ["acquiring"], "processing", { replicate_prediction_id: sub.reference, model: sub.model, model_version: sub.modelVersion, started_at: new Date().toISOString(), metadata: { ...meta, pipeline, provider_output_url: null } }, { predictionId: null });
    await recordJobEvent(job.id, "provider.submitted", { stage: "voice", provider: "replicate", predictionId: sub.reference, model: sub.model, version: sub.modelVersion, characters: text.length });
    await openProviderRun({ jobId: job.id, userId: job.user_id, feature: "ai_text_to_audio", mode: "text_to_audio", stage: "voice", provider: "replicate", model: sub.model, modelVersion: sub.modelVersion, providerJobId: sub.reference, test, latencyMs: Date.now() - startedAt, costEstimateUsdCents: (meta.provider_cost_estimate as { totalUsdCents?: number } | null)?.totalUsdCents ?? null, metadata: { settings: sub.settings, characters: text.length } });
    if (!moved) return { ok: false, code: "INTERNAL_ERROR", detail: "the row left acquiring before the prediction was recorded" };
    return { ok: true };
  }
  // the direct API: mark it running, then synthesise after the response
  const moved = await transitionJob(job.id, ["acquiring"], "processing", { started_at: new Date().toISOString(), model: resolved.model, model_version: resolved.provider.version || null });
  if (!moved) return { ok: false, code: "INTERNAL_ERROR", detail: "the row left acquiring before the synthesis started" };
  await recordJobEvent(job.id, "provider.submitted", { stage: "voice", provider: "elevenlabs", model: resolved.model, characters: text.length, inline: true });
  after(async () => {
    try {
      await runDirectTextToAudio(job.id);
    } catch (e) {
      console.error("[tta/generate] direct synthesis threw", { jobId: job.id, error: String(e).slice(0, 300) });
    }
  });
  return { ok: true };
}

/**
 * The delivery numbers as they were written on the row. A row from before
 * 2026-09-27 has none, and answers null — the provider's own defaults, which
 * is exactly what that row was generated with the first time.
 */
function readVoiceSettings(raw: unknown): { stability: number; similarityBoost: number; style: number; speakerBoost: boolean; speed: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return { stability: n(r.stability, 0.45), similarityBoost: n(r.similarityBoost, 0.8), style: n(r.style, 0.35), speakerBoost: r.speakerBoost !== false, speed: n(r.speed, 1) };
}

/** Load what the routes share; the admin flag decides the test mark and the concurrency tier. */
export async function loadTextToAudioShared(entitlement: AiEntitlement, isAdmin: boolean): Promise<TextToAudioShared> {
  return { settings: await getLandingSettings(), entitlement, isAdmin };
}

export { finalizeTextToAudioJob };
