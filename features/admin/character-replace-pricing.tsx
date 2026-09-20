"use client";

import { AlertTriangle, Coins } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { voiceProviderForModel, type CharacterReplaceConfig, type CharacterReplaceLaunchMode, type ReplacementModeConfig } from "@/lib/ai/character-replace/config";
import { FACE_ONLY_TIER_MAP, SKIN_FACE_TIER_MAP, UPPER_BODY_TIER_MAP, knownModelsFor, modelServesMode } from "@/lib/ai/character-replace/modes";
import { ELEVENLABS_REPLICATE_TTS_MODELS, ELEVENLABS_STS_MODELS, ELEVENLABS_TTS_MODELS, isElevenLabsReplicateModel, isElevenLabsTtsModel, VOICE_AGE_LABEL, VOICE_AGES, VOICE_GENDER_LABEL, VOICE_GENDERS, type VoiceAge, type VoiceGender } from "@/lib/ai/voice/elevenlabs-models";
import { formatCents } from "@/lib/ai/economy";
import { conversionApplies } from "@/lib/ai/character-replace/topup-fx";
import { AI_CURRENCIES, aiCurrencySymbol, isAiCurrency, majorInputToMinor, minorToMajorInput, type AiCurrency } from "@/lib/landing/bounds";
import type { LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — pricing, limits, recharge, and a member's balance
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13 (Part 3, §19): "Add a Character Replace pricing section
 * under the AI grouping… GENERAL / VIDEO PRICING / VOICE / LIP SYNC / LIMITS /
 * RECHARGE… validation… confirmation for dangerous values… show the current
 * pricing version."
 *
 * ── 🔴 ITS OWN FORM ─────────────────────────────────────────────────────────
 *
 * A save here POSTs ONE key, `frenzAiCharacterReplace`, and nothing else —
 * the same rule the Frenz AI access panel keeps for its fields — so this
 * panel can never clobber an allowance it does not display, and that panel
 * can never clobber a rate it does not display. The route merges the nested
 * object field by field; an EMPTY box means "leave it alone" (money may be
 * legitimately zero here, so `||` would be wrong — see `majorInputToMinor`).
 *
 * ── 🔴 DANGEROUS VALUES ASK TWICE ───────────────────────────────────────────
 *
 * A per-second rate that would price a 60-second video above ₦50,000, a
 * minimum or base price above ₦10,000, a recharge ceiling above ₦10,000,000,
 * a package outside its own bounds — these are almost always a slipped
 * decimal, and a slipped decimal here is a price a member sees. The form
 * names what looks wrong and asks for a second press. Nothing is refused:
 * the operator may mean it.
 *
 * ── The version is the server's ─────────────────────────────────────────────
 *
 * `pricingVersion` and `pricingUpdatedAt` are shown, never sent: the route
 * refuses them (`.strict()`), and the server bumps the version itself when a
 * saved price differs from the stored one (`versionCharacterReplacePricing`).
 */
export function CharacterReplacePricingPanel({ settings }: { settings: LandingSettings }) {
  const router = useRouter();
  const cr: CharacterReplaceConfig = settings.frenzAiCharacterReplace;
  const symbol = aiCurrencySymbol(settings.frenzAiCurrency);
  /*
    2026-09-20 — owner: "show USD as the currency, but when clicked convert
    the USD price to naira on Paystack, because my Paystack is naira." The
    wallet currency lives on the Frenz AI tab; THIS panel owns the currency
    Paystack collects in and the rate between them. Only a USD wallet
    converts (lib/ai/character-replace/topup-fx.ts).
  */
  const walletIsUsd = settings.frenzAiCurrency === "USD";

  /* ── general ── */
  const [enabled, setEnabled] = useState(cr.enabled);
  const [goFast, setGoFast] = useState(cr.providerGoFast);
  const [basePrice, setBasePrice] = useState(minorToMajorInput(cr.basePriceCents));
  const [minimum, setMinimum] = useState(minorToMajorInput(cr.minimumChargeCents));

  /*
    ── video pricing ──────────────────────────────────────────────────────
    Owner, 2026-09-14: "make the AI price set-up understandable and clear,
    so I can easily set the model price per second." The old form asked for
    a base rate, a multiplier per quality and an optional own rate — three
    numbers to reason about for one price. Every quality now shows ONE
    field: the price per second a member pays. It is saved as that
    quality's own rate (`perSecondCents`), which the pricing engine already
    prefers over base × multiplier — so the engine is untouched and the
    base rate / multipliers simply stop mattering once this form is saved.
    The starting value is whatever the member is charged today.
  */
  const [perSecond] = useState(minorToMajorInput(cr.pricePerSecondCents));
  const [qualities, setQualities] = useState(
    cr.qualities.map((q) => ({
      id: q.id,
      label: q.label,
      enabled: q.enabled,
      multiplier: String(q.multiplier),
      perSecond: minorToMajorInput(q.perSecondCents ?? Math.ceil(cr.pricePerSecondCents * q.multiplier)),
      useOwnRate: true,
    })),
  );

  /* ── voice ── */
  const [newVoice, setNewVoice] = useState(cr.voice.newVoiceEnabled);
  const [voiceSurcharge, setVoiceSurcharge] = useState(minorToMajorInput(cr.voice.surchargePerSecondCents));

  /* ── lip sync ── */
  const [lipSyncEnabled, setLipSyncEnabled] = useState(cr.lipSyncEnabled);
  const [lipTiers, setLipTiers] = useState(
    cr.lipSync.map((l) => ({ id: l.id, label: l.label, enabled: l.enabled, perSecond: minorToMajorInput(l.perSecondCents) })),
  );

  /* ── limits ── */
  const [maxSeconds, setMaxSeconds] = useState(String(cr.maximumDurationSeconds));
  const [maxUploadMb, setMaxUploadMb] = useState(String(Math.round(cr.maximumUploadBytes / (1024 * 1024))));
  const [trimMin, setTrimMin] = useState(String(cr.trim.minimumSeconds));

  /* ── Part 6: the two new modes ── */
  const modeState = (m: ReplacementModeConfig) => ({
    enabled: m.enabled,
    basePrice: minorToMajorInput(m.basePriceCents),
    tiers: m.tiers.map((t) => ({ id: t.id, label: t.label, enabled: t.enabled, perSecond: minorToMajorInput(t.perSecondCents) })),
    maxSeconds: String(m.maximumDurationSeconds),
    maxUploadMb: String(Math.round(m.maximumUploadBytes / (1024 * 1024))),
    maxPixels: String(m.maximumPixels),
    maxReferences: String(m.maximumReferenceImages),
    providerCostUsd: m.providerCostPerSecondUsdCents ? (m.providerCostPerSecondUsdCents / 100).toString() : "",
    model: m.provider.model,
  });
  const [faceOnly, setFaceOnly] = useState(modeState(cr.modes.face_only));
  const [skinFace, setSkinFace] = useState(modeState(cr.modes.skin_face));
  const [upperBody, setUpperBody] = useState(modeState(cr.modes.upper_body));
  /* ── the replacement-scope brief §13: provider cost protection ── */
  const [guardMargin, setGuardMargin] = useState(String(cr.pricingGuard.minimumMarginPercent));
  const [guardMinPrice, setGuardMinPrice] = useState(minorToMajorInput(cr.pricingGuard.minimumCustomerPriceCents));
  const [guardOverride, setGuardOverride] = useState(cr.pricingGuard.allowBelowMargin);

  /* ── Part 6: audio, voice (TTS), lip-sync models ── */
  const [audioEnabled, setAudioEnabled] = useState(cr.audio.replacementEnabled);
  const [audioMaxSeconds, setAudioMaxSeconds] = useState(String(cr.audio.maximumDurationSeconds));
  const [audioMaxMb, setAudioMaxMb] = useState(String(Math.round(cr.audio.maximumUploadBytes / (1024 * 1024))));
  const [shorterAudio, setShorterAudio] = useState<"silence" | "reject">(cr.audio.shorterAudio);
  const [coverage, setCoverage] = useState(String(Math.round(cr.audio.minimumCoverageFraction * 100)));
  const [syncMode, setSyncMode] = useState<"silence" | "loop" | "bounce">(cr.audio.syncMode);
  const [ttsEnabled, setTtsEnabled] = useState(cr.tts.enabled);
  const [ttsModel, setTtsModel] = useState(cr.tts.model);
  /* ── 2026-09-20: the voice changer ── */
  const [changeEnabled, setChangeEnabled] = useState(cr.tts.voiceChange.enabled);
  const [changeModel, setChangeModel] = useState(cr.tts.voiceChange.model);
  const [changePerSecond, setChangePerSecond] = useState(minorToMajorInput(cr.tts.voiceChange.perSecondCents));
  /** The catalogue's gender/age, editable (2026-09-20: a label the operator disagrees with is theirs to fix). Sent only when touched. */
  const [voiceRows, setVoiceRows] = useState(cr.voices.map((v) => ({ ...v, languages: [...v.languages] })));
  const [voicesTouched, setVoicesTouched] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ttsPerRequest, setTtsPerRequest] = useState(minorToMajorInput(cr.tts.perRequestCents));
  const [ttsPerCharacter, setTtsPerCharacter] = useState(minorToMajorInput(cr.tts.perCharacterCents));
  const [ttsMinChars, setTtsMinChars] = useState(String(cr.tts.minimumCharacters));
  const [ttsMaxChars, setTtsMaxChars] = useState(String(cr.tts.maximumCharacters));
  const [lipModels, setLipModels] = useState(cr.lipSync.map((l) => ({ id: l.id, model: l.model })));
  const [lipMaxSeconds, setLipMaxSeconds] = useState(String(cr.lipSyncMaximumDurationSeconds));
  /** §27: why the prices changed — asked for when they did, recorded beside the old version. */
  const [reason, setReason] = useState("");
  /* ── Part 7 §21: retention ── */
  const [resultHours, setResultHours] = useState(String(cr.retention.resultHours));
  const [savedDays, setSavedDays] = useState(String(cr.retention.savedResultDays));
  /* ── Part 8 §2, §4, §7, §8, §25: the switches, the limits, the breaker, the FX rate ── */
  const [processingEnabled, setProcessingEnabled] = useState(cr.ops.processingEnabled);
  const [maintenanceMode, setMaintenanceMode] = useState(cr.ops.maintenanceMode);
  const [maintenanceMessage, setMaintenanceMessage] = useState(cr.ops.maintenanceMessage);
  // Part 10 §25: the launch mode — production for every member, internal for administrators only
  const [launchMode, setLaunchMode] = useState<CharacterReplaceLaunchMode>(cr.ops.launchMode);
  const [breakerEnabled, setBreakerEnabled] = useState(cr.ops.circuitBreaker.enabled);
  const [breakerThreshold, setBreakerThreshold] = useState(String(cr.ops.circuitBreaker.failureThreshold));
  const [breakerWindow, setBreakerWindow] = useState(String(Math.round(cr.ops.circuitBreaker.windowSeconds / 60)));
  const [breakerCooldown, setBreakerCooldown] = useState(String(Math.round(cr.ops.circuitBreaker.cooldownSeconds / 60)));
  const [maxActiveUser, setMaxActiveUser] = useState(String(cr.limits.maxActiveJobsPerUser));
  const [maxActiveGlobal, setMaxActiveGlobal] = useState(String(cr.limits.maxActiveJobsGlobal));
  const [maxPerDay, setMaxPerDay] = useState(String(cr.limits.maxJobsPerUserPerDay));
  const [fxPerUsd, setFxPerUsd] = useState(cr.localMinorUnitsPerUsd > 0 ? minorToMajorInput(cr.localMinorUnitsPerUsd) : "");
  /* ── 2026-09-20: the live checkout rate (read once when the panel opens; never a poll) and the markup on it ── */
  const [fxMarkup, setFxMarkup] = useState(String(cr.recharge.fxMarkupPercent));
  const [liveRate, setLiveRate] = useState<{ applies: boolean; missing: boolean; rate: { minorPerUsd: number; marketPerUsd: number | null; markupPercent: number; source: string; fetchedAt: string | null; provider: string | null } | null } | "loading" | "failed">("loading");
  useEffect(() => {
    let alive = true;
    fetch("/api/admin/ai/character-replace/fx", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (alive) setLiveRate(d as Exclude<typeof liveRate, string>);
      })
      .catch(() => {
        if (alive) setLiveRate("failed");
      });
    return () => {
      alive = false;
    };
  }, []);

  /* ── recharge ── */
  const [checkoutCurrency, setCheckoutCurrency] = useState<AiCurrency>(isAiCurrency(cr.recharge.checkoutCurrency) ? cr.recharge.checkoutCurrency : "NGN");
  const checkoutSymbol = aiCurrencySymbol(checkoutCurrency);
  /** The rate is "one US dollar in X": X is the checkout currency for a USD wallet, the wallet currency otherwise (margin check only). */
  const rateSymbol = walletIsUsd ? checkoutSymbol : symbol;
  const [minTopup, setMinTopup] = useState(minorToMajorInput(cr.recharge.minCents));
  const [maxTopup, setMaxTopup] = useState(minorToMajorInput(cr.recharge.maxCents));
  const [packages, setPackages] = useState(
    [...cr.recharge.packages]
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ amount: minorToMajorInput(p.amountCents), enabled: p.enabled })),
  );

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string[] | null>(null);

  /* ─────────────────────── what will be sent ──────────────────────────── */

  const payload = useMemo(() => {
    const perSecondCents = majorInputToMinor(perSecond) ?? cr.pricePerSecondCents;
    return {
      enabled,
      providerGoFast: goFast,
      basePriceCents: majorInputToMinor(basePrice) ?? cr.basePriceCents,
      minimumChargeCents: majorInputToMinor(minimum) ?? cr.minimumChargeCents,
      pricePerSecondCents: perSecondCents,
      qualities: qualities.map((q) => ({
        id: q.id,
        enabled: q.enabled,
        multiplier: Number(q.multiplier) > 0 ? Number(q.multiplier) : (cr.qualities.find((c) => c.id === q.id)?.multiplier ?? 1),
        perSecondCents: q.useOwnRate ? (majorInputToMinor(q.perSecond) ?? 0) : null,
      })),
      voice: { newVoiceEnabled: newVoice, surchargePerSecondCents: majorInputToMinor(voiceSurcharge) ?? cr.voice.surchargePerSecondCents },
      lipSyncEnabled,
      lipSync: lipTiers.map((l) => ({
        id: l.id,
        enabled: l.enabled,
        perSecondCents: majorInputToMinor(l.perSecond) ?? cr.lipSync.find((c) => c.id === l.id)?.perSecondCents ?? 0,
        model: (lipModels.find((m) => m.id === l.id)?.model ?? "").trim() || (cr.lipSync.find((c) => c.id === l.id)?.model ?? ""),
      })),
      lipSyncMaximumDurationSeconds: lipMaxSeconds.trim() === "" ? cr.lipSyncMaximumDurationSeconds : Math.floor(Number(lipMaxSeconds)),
      retention: {
        resultHours: resultHours.trim() === "" ? cr.retention.resultHours : Math.floor(Number(resultHours)),
        savedResultDays: savedDays.trim() === "" ? cr.retention.savedResultDays : Math.floor(Number(savedDays)),
      },
      ops: {
        processingEnabled,
        maintenanceMode,
        maintenanceMessage: maintenanceMessage.trim() || cr.ops.maintenanceMessage,
        launchMode,
        circuitBreaker: {
          enabled: breakerEnabled,
          failureThreshold: breakerThreshold.trim() === "" ? cr.ops.circuitBreaker.failureThreshold : Math.floor(Number(breakerThreshold)),
          windowSeconds: breakerWindow.trim() === "" ? cr.ops.circuitBreaker.windowSeconds : Math.floor(Number(breakerWindow)) * 60,
          cooldownSeconds: breakerCooldown.trim() === "" ? cr.ops.circuitBreaker.cooldownSeconds : Math.floor(Number(breakerCooldown)) * 60,
        },
      },
      limits: {
        maxActiveJobsPerUser: maxActiveUser.trim() === "" ? cr.limits.maxActiveJobsPerUser : Math.floor(Number(maxActiveUser)),
        maxActiveJobsGlobal: maxActiveGlobal.trim() === "" ? cr.limits.maxActiveJobsGlobal : Math.floor(Number(maxActiveGlobal)),
        maxJobsPerUserPerDay: maxPerDay.trim() === "" ? cr.limits.maxJobsPerUserPerDay : Math.floor(Number(maxPerDay)),
      },
      localMinorUnitsPerUsd: fxPerUsd.trim() === "" ? 0 : (majorInputToMinor(fxPerUsd) ?? 0),
      modes: {
        face_only: modePayload(faceOnly, cr.modes.face_only),
        skin_face: modePayload(skinFace, cr.modes.skin_face),
        upper_body: modePayload(upperBody, cr.modes.upper_body),
      },
      pricingGuard: {
        minimumMarginPercent: guardMargin.trim() === "" ? cr.pricingGuard.minimumMarginPercent : Math.max(0, Number(guardMargin)),
        minimumCustomerPriceCents: majorInputToMinor(guardMinPrice) ?? cr.pricingGuard.minimumCustomerPriceCents,
        allowBelowMargin: guardOverride,
      },
      audio: {
        replacementEnabled: audioEnabled,
        maximumDurationSeconds: audioMaxSeconds.trim() === "" ? cr.audio.maximumDurationSeconds : Math.floor(Number(audioMaxSeconds)),
        maximumUploadBytes: audioMaxMb.trim() === "" ? cr.audio.maximumUploadBytes : Math.floor(Number(audioMaxMb)) * 1024 * 1024,
        shorterAudio,
        minimumCoverageFraction: coverage.trim() === "" ? cr.audio.minimumCoverageFraction : Math.max(0, Math.min(1, Number(coverage) / 100)),
        syncMode,
      },
      tts: {
        enabled: ttsEnabled,
        model: ttsModel.trim() || cr.tts.model,
        perRequestCents: majorInputToMinor(ttsPerRequest) ?? cr.tts.perRequestCents,
        perCharacterCents: majorInputToMinor(ttsPerCharacter) ?? cr.tts.perCharacterCents,
        minimumCharacters: ttsMinChars.trim() === "" ? cr.tts.minimumCharacters : Math.floor(Number(ttsMinChars)),
        maximumCharacters: ttsMaxChars.trim() === "" ? cr.tts.maximumCharacters : Math.floor(Number(ttsMaxChars)),
        voiceChange: {
          enabled: changeEnabled,
          model: changeModel,
          perSecondCents: majorInputToMinor(changePerSecond) ?? cr.tts.voiceChange.perSecondCents,
        },
      },
      maximumDurationSeconds: maxSeconds.trim() === "" ? cr.maximumDurationSeconds : Math.floor(Number(maxSeconds)),
      maximumUploadBytes: maxUploadMb.trim() === "" ? cr.maximumUploadBytes : Math.floor(Number(maxUploadMb)) * 1024 * 1024,
      trim: { minimumSeconds: trimMin.trim() === "" ? cr.trim.minimumSeconds : Number(trimMin) },
      ...(voicesTouched ? { voices: voiceRows.map((v) => ({ id: v.id, label: v.label, blurb: v.blurb, languages: v.languages, providerVoiceId: v.providerVoiceId, provider: v.provider, gender: v.gender, age: v.age })) } : {}),
      recharge: {
        checkoutCurrency,
        fxMarkupPercent: fxMarkup.trim() === "" ? cr.recharge.fxMarkupPercent : Math.max(0, Math.min(50, Number(fxMarkup) || 0)),
        minCents: majorInputToMinor(minTopup) ?? cr.recharge.minCents,
        maxCents: majorInputToMinor(maxTopup) ?? cr.recharge.maxCents,
        packages: packages
          .map((p, i) => ({ amountCents: majorInputToMinor(p.amount) ?? 0, enabled: p.enabled, order: i }))
          .filter((p) => p.amountCents > 0),
      },
    };
  }, [audioEnabled, audioMaxMb, audioMaxSeconds, basePrice, breakerCooldown, breakerEnabled, breakerThreshold, breakerWindow, changeEnabled, changeModel, changePerSecond, checkoutCurrency, coverage, cr, enabled, faceOnly, fxMarkup, fxPerUsd, goFast, guardMargin, guardMinPrice, guardOverride, launchMode, lipMaxSeconds, lipModels, lipSyncEnabled, lipTiers, maintenanceMessage, maintenanceMode, maxActiveGlobal, maxActiveUser, maxPerDay, maxSeconds, maxUploadMb, maxTopup, minTopup, minimum, newVoice, packages, perSecond, processingEnabled, qualities, resultHours, savedDays, shorterAudio, skinFace, syncMode, trimMin, ttsEnabled, ttsMaxChars, ttsMinChars, ttsModel, ttsPerCharacter, ttsPerRequest, upperBody, voiceRows, voiceSurcharge, voicesTouched]);

  /* ─────────────────────── validation, in words ───────────────────────── */

  const problems = useMemo(() => {
    const out: string[] = [];
    if (!Number.isInteger(payload.maximumDurationSeconds) || payload.maximumDurationSeconds < 1 || payload.maximumDurationSeconds > 120) {
      out.push("Longest video must be between 1 and 120 seconds.");
    }
    if (!(payload.trim.minimumSeconds >= 0.5 && payload.trim.minimumSeconds <= 30)) out.push("Shortest kept range must be between 0.5 and 30 seconds.");
    if (!(payload.maximumUploadBytes >= 1024 * 1024 && payload.maximumUploadBytes <= 100 * 1024 * 1024)) out.push("Largest upload must be between 1 and 100 MB.");
    if (payload.trim.minimumSeconds > payload.maximumDurationSeconds) out.push("Shortest kept range cannot exceed the longest video.");
    if (!payload.qualities.some((q) => q.enabled)) out.push("At least one quality must be on.");
    if (payload.recharge.minCents < 100) out.push(`Minimum recharge must be at least ${formatCents(100, symbol)}.`);
    if (payload.recharge.maxCents < payload.recharge.minCents) out.push("Maximum recharge must be at least the minimum.");
    for (const p of payload.recharge.packages) {
      if (p.amountCents < payload.recharge.minCents || p.amountCents > payload.recharge.maxCents) {
        out.push(`Package ${formatCents(p.amountCents, symbol)} is outside the recharge bounds.`);
      }
    }
    if (payload.recharge.packages.length === 0) out.push("Keep at least one recharge package.");
    if (conversionApplies(settings.frenzAiCurrency, payload.recharge.checkoutCurrency) && payload.localMinorUnitsPerUsd <= 0 && liveRate !== "loading" && (liveRate === "failed" || liveRate.missing)) {
      out.push(`No live rate could be fetched and no fallback "One US dollar in ${aiCurrencySymbol(payload.recharge.checkoutCurrency as AiCurrency)}" is set — until one of the two exists nobody can recharge.`);
    }
    if (payload.lipSyncEnabled && !payload.lipSync.some((l) => l.enabled)) out.push("Lip sync is on but no tier is on.");
    /* ── the replacement-scope brief §13: cost protection is a REFUSAL, not a warning, unless overridden ── */
    if (!payload.pricingGuard.allowBelowMargin) {
      const localPerUsdCent = walletIsUsd ? 1 : payload.localMinorUnitsPerUsd / 100;
      const margin = 1 + payload.pricingGuard.minimumMarginPercent / 100;
      for (const [label, m] of [["Face Only", payload.modes.face_only], ["Face + Head", payload.modes.skin_face], ["Upper Body", payload.modes.upper_body]] as const) {
        if (!m.enabled || m.providerCostPerSecondUsdCents <= 0 || localPerUsdCent <= 0) continue;
        for (const t of m.tiers) {
          if (t.enabled && t.perSecondCents < m.providerCostPerSecondUsdCents * localPerUsdCent * margin) out.push(`${label} ${t.id} is under the minimum margin (${payload.pricingGuard.minimumMarginPercent}% over the provider's estimated cost). Raise the price, or tick "Allow prices below the minimum margin" to override on purpose.`);
        }
      }
      if (payload.pricingGuard.minimumCustomerPriceCents > 0 && payload.minimumChargeCents < payload.pricingGuard.minimumCustomerPriceCents) out.push(`The minimum charge is under the minimum customer price (${formatCents(payload.pricingGuard.minimumCustomerPriceCents, symbol)}). Raise it, or override on purpose.`);
    }
    /* ── Part 6 ── */
    for (const [id, label, m] of [["face_only", "Face Only", payload.modes.face_only], ["skin_face", "Face + Head", payload.modes.skin_face], ["upper_body", "Upper Body", payload.modes.upper_body]] as const) {
      // the replacement-scope brief §12: a mode enabled without a provider that serves it, or without a price, cannot be saved on
      if (m.enabled && !modelServesMode(m.provider.model, id)) out.push(`${label}: no provider in this build serves it with model "${m.provider.model}" — pick one of the listed models or switch the mode off.`);
      if (m.enabled && !m.tiers.some((t) => t.enabled)) out.push(`${label}: switch on at least one quality, or switch the mode off.`);
      if (m.enabled && m.basePriceCents === 0 && m.tiers.filter((t) => t.enabled).every((t) => t.perSecondCents === 0)) out.push(`${label}: every enabled quality is free and there is no per-video price — members would pay nothing.`);
      if (!Number.isInteger(m.maximumDurationSeconds) || m.maximumDurationSeconds < 1 || m.maximumDurationSeconds > 120) out.push(`${label}: longest video must be between 1 and 120 seconds.`);
      if (!(m.maximumUploadBytes >= 1024 * 1024 && m.maximumUploadBytes <= 100 * 1024 * 1024)) out.push(`${label}: largest upload must be between 1 and 100 MB.`);
      if (!Number.isInteger(m.maximumReferenceImages) || m.maximumReferenceImages < 1 || m.maximumReferenceImages > 3) out.push(`${label}: reference images must be 1 to 3.`);
      if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(m.provider.model)) out.push(`${label}: the model must look like owner/model.`);
    }
    if (!(payload.audio.maximumDurationSeconds >= 1 && payload.audio.maximumDurationSeconds <= 1800)) out.push("Longest audio must be between 1 and 1800 seconds.");
    if (!(payload.tts.minimumCharacters >= 1 && payload.tts.maximumCharacters <= 10_000 && payload.tts.minimumCharacters <= payload.tts.maximumCharacters)) out.push("Dialogue length bounds must be 1 to 10,000 characters, minimum below maximum.");
    if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(payload.tts.model)) out.push("The voice model must look like owner/model.");
    for (const l of payload.lipSync) if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(l.model)) out.push(`${l.id} lip sync: the model must look like owner/model.`);
    if (!(payload.lipSyncMaximumDurationSeconds >= 1 && payload.lipSyncMaximumDurationSeconds <= 120)) out.push("Lip sync's longest video must be between 1 and 120 seconds.");
    if (!(payload.retention.resultHours >= 1 && payload.retention.resultHours <= 720)) out.push("Results are kept between 1 and 720 hours.");
    if (!(payload.retention.savedResultDays >= 1 && payload.retention.savedResultDays <= 365)) out.push("Saved results are kept between 1 and 365 days.");
    /* ── Part 8 ── */
    const b = payload.ops.circuitBreaker;
    if (!(Number.isInteger(b.failureThreshold) && b.failureThreshold >= 1 && b.failureThreshold <= 1000)) out.push("The breaker's failure count must be between 1 and 1,000.");
    if (!(b.windowSeconds >= 30 && b.windowSeconds <= 86_400)) out.push("The breaker's window must be between 1 and 1,440 minutes.");
    if (!(b.cooldownSeconds >= 30 && b.cooldownSeconds <= 86_400)) out.push("The breaker's pause must be between 1 and 1,440 minutes.");
    for (const [label, v, max] of [["Active videos per member", payload.limits.maxActiveJobsPerUser, 100], ["Active videos across FrenzSave", payload.limits.maxActiveJobsGlobal, 10_000], ["Videos per member per day", payload.limits.maxJobsPerUserPerDay, 10_000]] as const) {
      if (!(Number.isInteger(v) && v >= 0 && v <= max)) out.push(`${label} must be a whole number from 0 (no cap) to ${max.toLocaleString()}.`);
    }
    if (payload.ops.maintenanceMode && payload.ops.maintenanceMessage.trim().length < 10) out.push("Write the maintenance notice members will read (at least 10 characters).");
    return out;
  }, [liveRate, payload, settings.frenzAiCurrency, symbol]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    const sixty = 60;
    const effectiveRates = payload.qualities
      .filter((q) => q.enabled)
      .map((q) => ({ id: q.id, rate: q.perSecondCents ?? Math.ceil(payload.pricePerSecondCents * q.multiplier) }));
    for (const r of effectiveRates) {
      if (r.rate * sixty > 5_000_000) out.push(`${r.id} prices a 60-second video at ${formatCents(r.rate * sixty, symbol)}.`);
      if (r.rate === 0) out.push(`${r.id} is free — its rate is zero.`);
    }
    if (payload.pricePerSecondCents === 0 && effectiveRates.some((r) => r.rate === 0)) out.push("The base per-second rate is zero.");
    if (payload.minimumChargeCents > 1_000_000) out.push(`Minimum charge is ${formatCents(payload.minimumChargeCents, symbol)}.`);
    if (payload.basePriceCents > 1_000_000) out.push(`Base price per video is ${formatCents(payload.basePriceCents, symbol)}.`);
    if (payload.voice.surchargePerSecondCents * sixty > 5_000_000) out.push(`The new-voice surcharge adds ${formatCents(payload.voice.surchargePerSecondCents * sixty, symbol)} to a 60-second video.`);
    for (const l of payload.lipSync) {
      if (l.enabled && l.perSecondCents * sixty > 5_000_000) out.push(`${l.id} lip sync adds ${formatCents(l.perSecondCents * sixty, symbol)} to a 60-second video.`);
    }
    if (payload.recharge.maxCents > 1_000_000_000) out.push(`Maximum recharge is ${formatCents(payload.recharge.maxCents, symbol)}.`);
    if (!payload.enabled && cr.enabled) out.push("This switches Character Replace OFF for every member.");
    /* ── Part 6 §27: ₦0 or an unusual price on any mode or the voice ── */
    for (const [label, m] of [["Face Only", payload.modes.face_only], ["Face + Head", payload.modes.skin_face], ["Upper Body", payload.modes.upper_body]] as const) {
      for (const t of m.tiers) {
        if (!t.enabled) continue;
        if (t.perSecondCents === 0) out.push(`${label} ${t.id} is free — its rate is zero.`);
        if (t.perSecondCents * sixty > 5_000_000) out.push(`${label} ${t.id} prices a 60-second video at ${formatCents(t.perSecondCents * sixty, symbol)}.`);
      }
      if (!m.enabled && cr.modes[label === "Face Only" ? "face_only" : "skin_face"].enabled) out.push(`This switches ${label} OFF for every member.`);
    }
    if (payload.tts.enabled && payload.tts.perRequestCents === 0 && payload.tts.perCharacterCents === 0 && payload.voice.surchargePerSecondCents === 0) out.push("A generated voice is free — every voice fee is zero.");
    if (payload.tts.voiceChange.enabled && payload.tts.voiceChange.perSecondCents === 0 && payload.voice.surchargePerSecondCents === 0) out.push("Changing a voice is free — its per-second rate and the new-voice surcharge are both zero.");
    if (isElevenLabsReplicateModel(payload.tts.model) && !cr.voices.some((v) => v.provider === "elevenlabs")) out.push("ElevenLabs on Replicate is selected but the catalogue has none of its named voices — save once to restore them, or nobody can generate a voice.");
    if (isElevenLabsTtsModel(payload.tts.model) && !isElevenLabsReplicateModel(payload.tts.model) && !cr.voices.some((v) => v.provider === "elevenlabs_api")) {
      out.push("A direct ElevenLabs model is selected but the catalogue has no account voices — press Import voices below, or nobody can generate a voice.");
    }
    if (payload.tts.voiceChange.enabled && !cr.voices.some((v) => v.provider === "elevenlabs_api")) out.push("The voice changer is on but the catalogue has no ElevenLabs account voices (it needs voice ids, not the Replicate names) — press Import voices, or members will not be offered it.");
    /* ── Part 8 §2, §8: the switches and the caps ── */
    if (payload.ops.maintenanceMode && !cr.ops.maintenanceMode) out.push("This puts Character Replace into MAINTENANCE: no new videos for anyone until it is switched back. Finished videos stay reachable.");
    if (!payload.ops.processingEnabled && cr.ops.processingEnabled) out.push("This PAUSES new videos for every member. Videos already running finish normally.");
    if (payload.ops.launchMode === "internal" && cr.ops.launchMode !== "internal") out.push("This puts Character Replace into INTERNAL launch mode: only administrators can make a new video. Every other member sees it as not yet available. Finished videos, history and balances are untouched.");
    if (payload.ops.launchMode === "production" && cr.ops.launchMode === "internal") out.push("This opens Character Replace to EVERY member the plan policy allows. Make sure the provider balance and the price table are what you want first.");
    if (payload.limits.maxActiveJobsGlobal === 0) out.push("No platform-wide cap on active videos — a burst can run up the provider bill without a ceiling.");
    if (!payload.ops.circuitBreaker.enabled && cr.ops.circuitBreaker.enabled) out.push("The provider circuit breaker is OFF: a failing provider keeps being paid until somebody notices.");
    /* ── Part 8 §25: the margin, when the FX rate is known ── */
    const fx = payload.localMinorUnitsPerUsd;
    if (!walletIsUsd && payload.recharge.checkoutCurrency !== settings.frenzAiCurrency) {
      out.push(`Paystack will collect in ${settings.frenzAiCurrency}, the balance currency — "collects in" only applies when the balance is in USD.`);
    }
    if (walletIsUsd || fx > 0) {
      // a USD wallet is already in the provider's currency; otherwise the rate says what a US cent is in the wallet's minor units
      const localPerUsdCent = walletIsUsd ? 1 : fx / 100;
      const tiers: [string, number, number][] = [];
      for (const [label, m] of [["Face Only", payload.modes.face_only], ["Face + Head", payload.modes.skin_face], ["Upper Body", payload.modes.upper_body]] as const) {
        for (const t of m.tiers) if (t.enabled && m.providerCostPerSecondUsdCents > 0) tiers.push([`${label} ${t.id}`, t.perSecondCents, m.providerCostPerSecondUsdCents * localPerUsdCent]);
      }
      // Full Character carries no operator cost figure yet (the Wan provider predates Part 6); its margin is not checked here.
      // The replacement-scope brief §13: the configured minimum margin, not a constant; below it the save is refused unless the operator overrides.
      const margin = 1 + payload.pricingGuard.minimumMarginPercent / 100;
      for (const [label, price, cost] of tiers) {
        if (price < cost) out.push(`${label} sells BELOW the provider's cost: ${formatCents(Math.round(price), symbol)}/s charged against about ${formatCents(Math.round(cost), symbol)}/s paid.`);
        else if (price < cost * margin) out.push(`${label} is under the ${payload.pricingGuard.minimumMarginPercent}% minimum margin: ${formatCents(Math.round(price), symbol)}/s charged against about ${formatCents(Math.round(cost), symbol)}/s paid.`);
      }
    } else {
      out.push("No exchange rate is set (Recharge), so prices cannot be checked against the provider's USD cost.");
    }
    if (payload.tts.perCharacterCents * payload.tts.maximumCharacters > 5_000_000) out.push(`The per-character fee prices the longest dialogue at ${formatCents(payload.tts.perCharacterCents * payload.tts.maximumCharacters, symbol)}.`);
    return out;
  }, [cr.enabled, cr.modes, cr.ops.circuitBreaker.enabled, cr.ops.launchMode, cr.ops.maintenanceMode, cr.ops.processingEnabled, cr.voices, payload, settings.frenzAiCurrency, symbol, walletIsUsd]);

  const priceChanged = useMemo(() => {
    const before = cr;
    return (
      payload.pricePerSecondCents !== before.pricePerSecondCents ||
      payload.basePriceCents !== before.basePriceCents ||
      payload.minimumChargeCents !== before.minimumChargeCents ||
      payload.voice.surchargePerSecondCents !== before.voice.surchargePerSecondCents ||
      payload.qualities.some((q) => {
        const b = before.qualities.find((x) => x.id === q.id);
        return !b || b.multiplier !== q.multiplier || b.perSecondCents !== q.perSecondCents || b.enabled !== q.enabled;
      }) ||
      payload.lipSync.some((l) => {
        const b = before.lipSync.find((x) => x.id === l.id);
        return !b || b.perSecondCents !== l.perSecondCents || b.enabled !== l.enabled;
      }) ||
      (["face_only", "skin_face"] as const).some((id) =>
        payload.modes[id].enabled !== before.modes[id].enabled ||
        payload.modes[id].tiers.some((t) => {
          const b = before.modes[id].tiers.find((x) => x.id === t.id);
          return !b || b.perSecondCents !== t.perSecondCents || b.enabled !== t.enabled;
        }),
      ) ||
      payload.tts.enabled !== before.tts.enabled ||
      payload.tts.perRequestCents !== before.tts.perRequestCents ||
      payload.tts.perCharacterCents !== before.tts.perCharacterCents
    );
  }, [cr, payload]);

  /* ─────────────────────── the save ───────────────────────────────────── */

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    setConfirming(null);
    try {
      const res = await fetch("/api/admin/landing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 🔴 One key. The route merges the nested object; nothing else is touched. The reason rides beside the prices (§27).
        body: JSON.stringify({ frenzAiCharacterReplace: { ...payload, ...(priceChanged && reason.trim() ? { pricingChangeReason: reason.trim() } : {}) } }),
      });
      const json = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: priceChanged ? "Saved. Pricing version bumped — applies to the next quote." : "Saved. Applies to the next quote." }
          : { ok: false, text: json.error ?? "Failed to save." },
      );
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (problems.length > 0) {
      setMsg({ ok: false, text: problems[0]! });
      return;
    }
    // §27: a price change is confirmed, and asked for a reason, before it is saved.
    if ((warnings.length > 0 || priceChanged) && confirming === null) {
      setConfirming(warnings.length ? warnings : ["Prices are changing. The current version is kept in the history; existing jobs keep their own snapshot."]);
      return;
    }
    void submit();
  };

  const input =
    "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Coins className="h-5 w-5 text-primary" /> Character Replace pricing
      </h2>
      <p className="mb-2 text-sm text-muted-foreground">
        What Character Replace costs a member, in {settings.frenzAiCurrency} — Full Character (Wan 2.2), Face Only and Skin + Face, the voice and the lip sync. Every quote is calculated on the server from
        these numbers; nothing here is read by the browser.
      </p>
      <p className="mb-6 text-xs text-muted-foreground">
        Pricing version <strong className="tabular-nums">v{cr.pricingVersion}</strong>
        {cr.pricingUpdatedAt ? <> · last price change {new Date(cr.pricingUpdatedAt).toLocaleString()}</> : null}
        {cr.pricingHistory.length ? <> · {cr.pricingHistory.length} earlier version{cr.pricingHistory.length === 1 ? "" : "s"} kept</> : null}
      </p>

      <form onSubmit={save} className="space-y-6">
        {/* ── GENERAL ── */}
        <Group title="General">
          <Toggle
            label="Character Replace is available"
            hint="Off hides the entry card's action and the workspace says the tool is unavailable right now. Nothing already running is affected."
            checked={enabled}
            onChange={setEnabled}
          />
          <div className="mt-4">
            <Toggle
              label="Faster provider mode"
              hint="The model's go_fast switch. Quicker runs, possibly a little less detail. Internal — members never see or choose this, and it does not change the price."
              checked={goFast}
              onChange={setGoFast}
            />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field id="cr-base-price" label="Base price per video" hint="Added once to every video on top of the per-second price. Zero is fine.">
              <input id="cr-base-price" type="number" inputMode="decimal" min={0} step="any" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} className={input} />
            </Field>
            <Field id="cr-minimum" label="Minimum charge per video" hint="A very short video is billed at least this much.">
              <input id="cr-minimum" type="number" inputMode="decimal" min={0} step="any" value={minimum} onChange={(e) => setMinimum(e.target.value)} className={input} />
            </Field>
          </div>
        </Group>

        {/* ── PRICE PER SECOND — one number per replacement type and quality ── */}
        <Group title="Price per second">
          <p className="mb-3 text-sm text-muted-foreground">
            What a member pays for each second of video, by replacement type and quality. A 10-second video costs ten times the number you type here (plus the
            base price and any voice or lip-sync add-on below). Untick a row to hide that quality from members.
          </p>
          {(() => {
            /*
              One row model, drawn twice: stacked cards under `sm` (a phone
              cannot type into a six-column table — owner, 2026-09-15) and the
              table from `sm` up. Every field writes the same state either way.
            */
            type PriceRow = {
              key: string;
              type: string;
              first: boolean;
              quality: string;
              detail: string | null;
              note: string | null;
              value: string;
              supported: boolean;
              enabled: boolean;
              costUsdCents: number;
              setValue: (v: string) => void;
              setEnabled: (v: boolean) => void;
            };
            const rows: PriceRow[] = [
              ...qualities.map<PriceRow>((q, i) => ({
                key: `full-${q.id}`,
                type: "Full Character",
                first: i === 0,
                quality: q.id === "480p" ? "Standard" : q.id === "720p" ? "HD" : "Full HD",
                detail: q.label,
                note: q.id === "1080p" ? "provider documents 480p and 720p only" : null,
                value: q.perSecond,
                supported: true,
                enabled: q.enabled,
                costUsdCents: 0,
                setValue: (v) => setQualities((qs) => qs.map((x, j) => (j === i ? { ...x, perSecond: v, useOwnRate: true } : x))),
                setEnabled: (v) => setQualities((qs) => qs.map((x, j) => (j === i ? { ...x, enabled: v } : x))),
              })),
              ...(
                [
                  ["Face Only", faceOnly, setFaceOnly, FACE_ONLY_TIER_MAP, cr.modes.face_only],
                  ["Face + Head", skinFace, setSkinFace, SKIN_FACE_TIER_MAP, cr.modes.skin_face],
                  ["Upper Body", upperBody, setUpperBody, UPPER_BODY_TIER_MAP, cr.modes.upper_body],
                ] as const
              ).flatMap(([label, st, set, map, before]) =>
                st.tiers.map<PriceRow>((t, i) => {
                  const supported = map[t.id].support === "supported";
                  return {
                    key: `${label}-${t.id}`,
                    type: label,
                    first: i === 0,
                    quality: t.label,
                    detail: null,
                    note: supported ? null : "not available for this type",
                    value: t.perSecond,
                    supported,
                    enabled: t.enabled && supported && st.enabled,
                    costUsdCents: before.providerCostPerSecondUsdCents,
                    setValue: (v) => set({ ...st, tiers: st.tiers.map((x, j) => (j === i ? { ...x, perSecond: v } : x)) }),
                    setEnabled: (v) => set({ ...st, tiers: st.tiers.map((x, j) => (j === i ? { ...x, enabled: v } : x)) }),
                  };
                }),
              ),
            ];
            const tenSeconds = (r: PriceRow) => (r.supported ? formatCents((majorInputToMinor(r.value) ?? 0) * 10, symbol) : "—");
            const cost = (r: PriceRow) => (r.costUsdCents > 0 ? `$${(r.costUsdCents / 100).toFixed(3)}/s` : "—");
            const field = (r: PriceRow, wide: boolean) => (
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{symbol}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  aria-label={`${r.type} ${r.quality} price per second`}
                  value={r.value}
                  disabled={!r.supported}
                  onChange={(e) => r.setValue(e.target.value)}
                  className={cn(input, "mt-0 disabled:opacity-50", wide ? "w-28" : "w-full max-w-[9rem]")}
                />
              </span>
            );
            const onSwitch = (r: PriceRow) => (
              <input type="checkbox" aria-label={`${r.type} ${r.quality} available`} checked={r.enabled} disabled={!r.supported} onChange={(e) => r.setEnabled(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
            );
            return (
              <>
                {/* phone: one card per row */}
                <ul className="space-y-2 sm:hidden">
                  {rows.map((r) => (
                    <li key={r.key} className={cn("rounded-2xl border border-border/70 bg-card px-3.5 py-3", (!r.supported || !r.enabled) && "opacity-60")}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{r.type}</p>
                          <p className="text-sm font-semibold">
                            {r.quality}
                            {r.detail ? <span className="ml-1 font-normal text-muted-foreground">({r.detail})</span> : null}
                          </p>
                          {r.note ? <p className="text-[11px] text-muted-foreground">{r.note}</p> : null}
                        </div>
                        <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                          {onSwitch(r)}
                          On
                        </label>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                        <span className="text-xs text-muted-foreground">Per second</span>
                        {field(r, false)}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>10-second video</span>
                        <span className="tabular-nums">{tenSeconds(r)}</span>
                      </div>
                      {r.costUsdCents > 0 ? (
                        <div className="mt-0.5 flex items-center justify-between text-[11.5px] text-muted-foreground">
                          <span>Provider cost</span>
                          <span className="tabular-nums">{cost(r)}</span>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {/* tablet and up: the table */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[40rem] text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3">Replacement type</th>
                        <th className="py-2 pr-3">Quality</th>
                        <th className="py-2 pr-3">Members pay, per second</th>
                        <th className="py-2 pr-3">10-second video</th>
                        <th className="py-2 pr-3">Provider cost</th>
                        <th className="py-2">On</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {rows.map((r) => (
                        <tr key={r.key} className={cn((!r.supported || !r.enabled) && "opacity-55")}>
                          <td className="py-2.5 pr-3 font-semibold">{r.first ? r.type : ""}</td>
                          <td className="py-2.5 pr-3">
                            {r.quality}
                            {r.detail ? <span className="text-muted-foreground"> ({r.detail})</span> : null}
                            {r.note ? <span className="block text-[11px] text-muted-foreground">{r.note}</span> : null}
                          </td>
                          <td className="py-2.5 pr-3">{field(r, true)}</td>
                          <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">{tenSeconds(r)}</td>
                          <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">{cost(r)}</td>
                          <td className="py-2.5">{onSwitch(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}
          <p className="mt-3 text-xs text-muted-foreground">
            Provider cost is your own estimate per second, entered under each replacement type&apos;s settings below; with an exchange rate (Recharge) the save warns when a price is under it. Members never see either.
          </p>
        </Group>

        {/* ── REPLACEMENT MODES (Part 6) ── */}
        {(
          [
            ["face_only", "Face Only", faceOnly, setFaceOnly, FACE_ONLY_TIER_MAP, "Replaces the face; the body, hair and skin of the video stay. The face-swap model has ONE configuration, so High and Ultra cannot be honoured and stay off."],
            ["skin_face", "Face + Head", skinFace, setSkinFace, SKIN_FACE_TIER_MAP, "Replaces the face, identity and skin — the head's appearance — from 1–3 photos; the body and clothes stay. Standard = 720p turbo, High = 720p, Ultra = 1080p."],
            ["upper_body", "Upper Body", upperBody, setUpperBody, UPPER_BODY_TIER_MAP, "Replaces the face, head and upper-body appearance from a waist-up photo, on a body-capable model (Wan 2.2 today). Standard = 480p, High = 720p; Ultra is not offered."],
          ] as const
        ).map(([id, label, st, set, _map, blurb]) => (
          <Group key={id} title={`${label} settings`}>
            <p className="mb-3 text-xs text-muted-foreground">{blurb} Prices per second are set in the table above.</p>
            <Toggle label={`${label} is available`} hint="Off hides the mode on the selector. Nothing already running is affected." checked={st.enabled} onChange={(v) => set({ ...st, enabled: v })} />
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field id={`cr-${id}-base`} label="Price per video" hint="Added once per video for this replacement type, on top of the per-second rate. Zero means none.">
                <input id={`cr-${id}-base`} type="number" inputMode="decimal" min={0} step="any" value={st.basePrice} onChange={(e) => set({ ...st, basePrice: e.target.value })} className={input} />
              </Field>
              <Field id={`cr-${id}-max-seconds`} label="Longest video (seconds)" hint="1 to 120; never above the tool's own ceiling.">
                <input id={`cr-${id}-max-seconds`} type="number" inputMode="numeric" min={1} max={120} value={st.maxSeconds} onChange={(e) => set({ ...st, maxSeconds: e.target.value })} className={input} />
              </Field>
              <Field id={`cr-${id}-max-upload`} label="Largest upload (MB)" hint="Same Storage caveat as above.">
                <input id={`cr-${id}-max-upload`} type="number" inputMode="numeric" min={1} max={100} value={st.maxUploadMb} onChange={(e) => set({ ...st, maxUploadMb: e.target.value })} className={input} />
              </Field>
              <Field id={`cr-${id}-max-pixels`} label="Maximum resolution (pixels)" hint="Width × height of the source, e.g. 8294400 for 4K.">
                <input id={`cr-${id}-max-pixels`} type="number" inputMode="numeric" min={640 * 360} max={3840 * 2160} value={st.maxPixels} onChange={(e) => set({ ...st, maxPixels: e.target.value })} className={input} />
              </Field>
              <Field id={`cr-${id}-max-refs`} label="Reference images" hint={id === "skin_face" ? "Up to three photos of the same person." : `${label} takes one.`}>
                <input id={`cr-${id}-max-refs`} type="number" inputMode="numeric" min={1} max={id === "skin_face" ? 3 : 1} value={st.maxReferences} onChange={(e) => set({ ...st, maxReferences: e.target.value })} className={input} />
              </Field>
              <Field id={`cr-${id}-cost`} label="Provider cost estimate ($ per second)" hint="Your estimate of the Replicate bill. Recorded on every job beside the member's charge; never shown to members.">
                <input id={`cr-${id}-cost`} type="number" inputMode="decimal" min={0} step="any" value={st.providerCostUsd} onChange={(e) => set({ ...st, providerCostUsd: e.target.value })} className={input} />
              </Field>
              <Field id={`cr-${id}-model`} label="Provider model" hint="Provider: Replicate. Only models this build carries an adapter for; the version pin lives with the adapter. Members never see the name.">
                <select id={`cr-${id}-model`} value={st.model} onChange={(e) => set({ ...st, model: e.target.value })} className={input}>
                  {knownModelsFor(id).map((m) => (
                    <option key={m.model} value={m.model}>
                      {m.label}
                    </option>
                  ))}
                  {!modelServesMode(st.model, id) ? <option value={st.model}>{st.model} (no adapter — mode cannot run)</option> : null}
                </select>
              </Field>
            </div>
          </Group>
        ))}

        {/* ── VOICE ── */}
        <Group title="Voice">
          <Toggle
            label="Offer a new voice"
            hint="Off keeps every member on their original audio and hides the Voice & Language choices."
            checked={newVoice}
            onChange={setNewVoice}
          />
          <div className="mt-4">
            <Field id="cr-voice-surcharge" label="New-voice surcharge per second" hint="Added per second when a new voice is chosen. Zero means the voice is included.">
              <input id="cr-voice-surcharge" type="number" inputMode="decimal" min={0} step="any" value={voiceSurcharge} onChange={(e) => setVoiceSurcharge(e.target.value)} className={cn(input, "sm:max-w-xs")} />
            </Field>
          </div>
          <div className="mt-5 border-t border-border/60 pt-4">
            <Toggle label="Generate a voice from text" hint="Text-to-speech through Replicate. The languages offered are your catalogue intersected with what the model speaks." checked={ttsEnabled} onChange={setTtsEnabled} />
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field
                id="cr-tts-model"
                label="Voice model"
                hint={
                  isElevenLabsReplicateModel(ttsModel)
                    ? "ElevenLabs on Replicate — the same token as every other model, no other key. The 26 named voices below."
                    : isElevenLabsTtsModel(ttsModel)
                      ? "ElevenLabs through its own API, called by the worker. Needs ELEVENLABS_API_KEY on Railway and Vercel, and Import voices for the account's voice ids."
                      : "MiniMax on Replicate — a prediction with a voice stage."
                }
              >
                <select id="cr-tts-model" value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} className={input}>
                  <optgroup label="Replicate (one token for everything)">
                    {Object.entries(ELEVENLABS_REPLICATE_TTS_MODELS).map(([id, m]) => (
                      <option key={id} value={id}>
                        {m.label}
                      </option>
                    ))}
                    <option value="minimax/speech-02-hd">MiniMax Speech-02 HD on Replicate</option>
                    <option value="minimax/speech-02-turbo">MiniMax Speech-02 Turbo on Replicate</option>
                  </optgroup>
                  <optgroup label="ElevenLabs direct (needs ELEVENLABS_API_KEY)">
                    {Object.entries(ELEVENLABS_TTS_MODELS).map(([id, m]) => (
                      <option key={id} value={id}>
                        {m.label}
                      </option>
                    ))}
                  </optgroup>
                  {!isElevenLabsTtsModel(ttsModel) && !/^minimax\/speech-02-(hd|turbo)$/.test(ttsModel) ? <option value={ttsModel}>{ttsModel}</option> : null}
                </select>
              </Field>
              <Field id="cr-tts-request" label="Price per generated voice" hint="Charged once per job that generates a voice.">
                <input id="cr-tts-request" type="number" inputMode="decimal" min={0} step="any" value={ttsPerRequest} onChange={(e) => setTtsPerRequest(e.target.value)} className={input} />
              </Field>
              <Field id="cr-tts-char" label="Price per character" hint="Charged per character of dialogue.">
                <input id="cr-tts-char" type="number" inputMode="decimal" min={0} step="any" value={ttsPerCharacter} onChange={(e) => setTtsPerCharacter(e.target.value)} className={input} />
              </Field>
              <Field id="cr-tts-min" label="Shortest dialogue (characters)">
                <input id="cr-tts-min" type="number" inputMode="numeric" min={1} max={10000} value={ttsMinChars} onChange={(e) => setTtsMinChars(e.target.value)} className={input} />
              </Field>
              <Field id="cr-tts-max" label="Longest dialogue (characters)">
                <input id="cr-tts-max" type="number" inputMode="numeric" min={1} max={10000} value={ttsMaxChars} onChange={(e) => setTtsMaxChars(e.target.value)} className={input} />
              </Field>
            </div>
          </div>

          {/* ── 2026-09-20: the voice changer ── */}
          <div className="mt-5 border-t border-border/60 pt-4">
            <Toggle
              label="Members may change the voice of their own recording"
              hint="An uploaded audio file or a gallery video's sound, spoken by a catalogue voice of the gender and age the member picks. Speech-to-speech is NOT on Replicate: this needs ELEVENLABS_API_KEY on Railway (the worker) and the account's voice ids (Import voices). Until then it is not offered to members."
              checked={changeEnabled}
              onChange={setChangeEnabled}
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field id="cr-change-model" label="Voice-changer model">
                <select id="cr-change-model" value={changeModel} onChange={(e) => setChangeModel(e.target.value)} className={input}>
                  {Object.entries(ELEVENLABS_STS_MODELS).map(([id, m]) => (
                    <option key={id} value={id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="cr-change-rate" label={`Price per second of video (${symbol})`} hint="Added per second when a member changes the voice. Zero means it is included.">
                <input id="cr-change-rate" type="number" inputMode="decimal" min={0} step="any" value={changePerSecond} onChange={(e) => setChangePerSecond(e.target.value)} className={input} />
              </Field>
            </div>
          </div>

          {/* ── 2026-09-20: the voice catalogue ── */}
          <div className="mt-5 border-t border-border/60 pt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Voice catalogue</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Members see the voices of the selected model&apos;s provider, filtered by gender and age. The Replicate models take the 26 named voices shipped here (Kuon left out — its
                  gender and age are undocumented). Import reads your ElevenLabs account&apos;s library as separate &quot;account&quot; rows — what the voice changer and a direct-API model use — and
                  leaves the Replicate names and the MiniMax rows alone. Provider ids never reach a member.
                </p>
              </div>
              <button
                type="button"
                disabled={importing}
                onClick={async () => {
                  setImporting(true);
                  setImportMsg(null);
                  try {
                    const res = await fetch("/api/admin/ai/character-replace/voices/import", { method: "POST", cache: "no-store" });
                    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; imported?: number; total?: number; error?: string };
                    if (!res.ok || !data.ok) setImportMsg({ ok: false, text: data.error ?? "Import failed." });
                    else {
                      setImportMsg({ ok: true, text: `Imported ${data.imported} ElevenLabs voice${data.imported === 1 ? "" : "s"} — ${data.total} in the catalogue. Reloading…` });
                      router.refresh();
                    }
                  } catch {
                    setImportMsg({ ok: false, text: "Import failed." });
                  } finally {
                    setImporting(false);
                  }
                }}
                className="shrink-0 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold transition hover:border-foreground/30 disabled:opacity-60"
              >
                {importing ? "Importing…" : "Import voices from ElevenLabs"}
              </button>
            </div>
            {importMsg ? <p className={cn("mt-2 text-xs font-semibold", importMsg.ok ? "text-emerald-600" : "text-rose-500")}>{importMsg.text}</p> : null}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-semibold">Voice</th>
                    <th className="py-1.5 pr-3 font-semibold">Provider</th>
                    <th className="py-1.5 pr-3 font-semibold">Gender</th>
                    <th className="py-1.5 pr-3 font-semibold">Age</th>
                    <th className="py-1.5 font-semibold">Languages</th>
                  </tr>
                </thead>
                <tbody>
                  {voiceRows.map((v, i) => (
                    <tr key={v.id} className={cn("border-t border-border/50", voiceProviderForModel(ttsModel) !== v.provider && v.provider !== "elevenlabs_api" && "text-muted-foreground/70")}>
                      <td className="py-1.5 pr-3">
                        <span className="font-semibold text-foreground">{v.label}</span>
                        {v.blurb ? <span className="text-muted-foreground"> · {v.blurb}</span> : null}
                      </td>
                      <td className="py-1.5 pr-3">{v.provider === "elevenlabs" ? "ElevenLabs (Replicate)" : v.provider === "elevenlabs_api" ? "ElevenLabs (account)" : "MiniMax"}</td>
                      <td className="py-1.5 pr-3">
                        <select
                          aria-label={`${v.label} gender`}
                          value={v.gender}
                          onChange={(e) => {
                            const gender = e.target.value as VoiceGender;
                            setVoiceRows((rows) => rows.map((r, j) => (j === i ? { ...r, gender } : r)));
                            setVoicesTouched(true);
                          }}
                          className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                        >
                          {VOICE_GENDERS.map((g) => (
                            <option key={g} value={g}>
                              {VOICE_GENDER_LABEL[g]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-3">
                        <select
                          aria-label={`${v.label} age`}
                          value={v.age}
                          onChange={(e) => {
                            const age = e.target.value as VoiceAge;
                            setVoiceRows((rows) => rows.map((r, j) => (j === i ? { ...r, age } : r)));
                            setVoicesTouched(true);
                          }}
                          className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                        >
                          {VOICE_AGES.map((a) => (
                            <option key={a} value={a}>
                              {VOICE_AGE_LABEL[a]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5">{v.languages.length ? v.languages.join(", ") : "all"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Group>

        {/* ── AUDIO (Part 6) ── */}
        <Group title="Audio">
          <Toggle label="Members may upload their own replacement audio" hint="MP3, WAV, M4A, AAC, OGG. Off leaves generated voices as the only new-voice source." checked={audioEnabled} onChange={setAudioEnabled} />
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field id="cr-audio-max-seconds" label="Longest audio (seconds)">
              <input id="cr-audio-max-seconds" type="number" inputMode="numeric" min={1} max={1800} value={audioMaxSeconds} onChange={(e) => setAudioMaxSeconds(e.target.value)} className={input} />
            </Field>
            <Field id="cr-audio-max-mb" label="Largest audio upload (MB)">
              <input id="cr-audio-max-mb" type="number" inputMode="numeric" min={1} max={100} value={audioMaxMb} onChange={(e) => setAudioMaxMb(e.target.value)} className={input} />
            </Field>
            <Field id="cr-audio-shorter" label="Audio shorter than the video" hint="Pad the end with silence, or refuse the job before it is charged.">
              <select id="cr-audio-shorter" value={shorterAudio} onChange={(e) => setShorterAudio(e.target.value as "silence" | "reject")} className={input}>
                <option value="silence">Pad with silence</option>
                <option value="reject">Refuse</option>
              </select>
            </Field>
            <Field id="cr-audio-coverage" label="Least of the video the audio must cover (%)" hint="Below this the job is refused. 0 disables.">
              <input id="cr-audio-coverage" type="number" inputMode="numeric" min={0} max={100} value={coverage} onChange={(e) => setCoverage(e.target.value)} className={input} />
            </Field>
            <Field id="cr-audio-sync" label="Lip-sync residual mode" hint="What the lip-sync model does with a frame's rounding after our own fit. Never cut_off or remap.">
              <select id="cr-audio-sync" value={syncMode} onChange={(e) => setSyncMode(e.target.value as "silence" | "loop" | "bounce")} className={input}>
                <option value="silence">Silence</option>
                <option value="loop">Loop</option>
                <option value="bounce">Bounce</option>
              </select>
            </Field>
          </div>
        </Group>

        {/* ── LIP SYNC ── */}
        <Group title="Lip sync">
          <Toggle
            label="Offer lip sync with a new voice"
            hint="Off hides the tiers. A tier can only be chosen together with a new voice."
            checked={lipSyncEnabled}
            onChange={setLipSyncEnabled}
          />
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {lipTiers.map((l, i) => (
              <div key={l.id} className="rounded-2xl border border-border/70 bg-background/60 p-3 sm:p-4">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={l.enabled} onChange={(e) => setLipTiers((ts) => ts.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                  {l.label}
                </label>
                <Field id={`cr-lip-${l.id}`} label="Lip-sync price per second" hint="Added per second of video when this tier is chosen." className="mt-3">
                  <input id={`cr-lip-${l.id}`} type="number" inputMode="decimal" min={0} step="any" value={l.perSecond} onChange={(e) => setLipTiers((ts) => ts.map((x, j) => (j === i ? { ...x, perSecond: e.target.value } : x)))} className={input} />
                </Field>
                <Field id={`cr-lip-model-${l.id}`} label="Model" hint="Provider: Replicate. sync/lipsync-2 or sync/lipsync-2-pro today." className="mt-3">
                  <input
                    id={`cr-lip-model-${l.id}`}
                    type="text"
                    value={lipModels.find((m) => m.id === l.id)?.model ?? ""}
                    onChange={(e) => setLipModels((ms) => ms.map((m) => (m.id === l.id ? { ...m, model: e.target.value } : m)))}
                    className={cn(input, "font-mono text-xs")}
                  />
                </Field>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Field id="cr-lip-max" label="Longest video for lip sync (seconds)" hint="1 to 120. A longer kept range hides the lip-sync toggle.">
              <input id="cr-lip-max" type="number" inputMode="numeric" min={1} max={120} value={lipMaxSeconds} onChange={(e) => setLipMaxSeconds(e.target.value)} className={cn(input, "sm:max-w-xs")} />
            </Field>
          </div>
        </Group>

        {/* ── LIMITS ── */}
        <Group title="Limits">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="cr-max-seconds" label="Longest video (seconds)" hint="Longer uploads are trimmed to this before they can continue. 1 to 120.">
              <input id="cr-max-seconds" type="number" inputMode="numeric" min={1} max={120} value={maxSeconds} onChange={(e) => setMaxSeconds(e.target.value)} className={input} />
            </Field>
            <Field id="cr-trim-min" label="Shortest kept range (seconds)" hint="A trim cannot keep less than this. 0.5 to 30.">
              <input id="cr-trim-min" type="number" inputMode="decimal" min={0.5} max={30} step="any" value={trimMin} onChange={(e) => setTrimMin(e.target.value)} className={input} />
            </Field>
            <Field id="cr-max-upload" label="Largest upload (MB)" hint="Supabase Storage refuses any file over the project's global limit (50 MB unless you raised it in the Supabase dashboard). Raise this only after raising that.">
              <input id="cr-max-upload" type="number" inputMode="numeric" min={1} max={100} value={maxUploadMb} onChange={(e) => setMaxUploadMb(e.target.value)} className={input} />
            </Field>
          </div>
        </Group>

        {/* ── SWITCHES, LIMITS & SAFETY (Part 8 §2, §4, §7, §8, §25) ── */}
        <Group title="Switches, limits & safety">
          <div className="space-y-4">
            <Toggle label="New videos can start" hint="Off pauses every new start at once — members see a notice, nothing is charged, videos already running finish. The kill switch for a bad day at the provider." checked={processingEnabled} onChange={setProcessingEnabled} />
            <Field id="cr-launch-mode" label="Launch mode" hint="Production: every member the plan policy allows. Internal: only administrators can make a new video — everyone else reads that it is opening gradually. The safe way to switch it on, test with your own account, then open it up.">
              <select id="cr-launch-mode" value={launchMode} onChange={(e) => setLaunchMode(e.target.value === "internal" ? "internal" : "production")} className={input}>
                <option value="production">Production — every member</option>
                <option value="internal">Internal — administrators only</option>
              </select>
            </Field>
            <Toggle label="Maintenance mode" hint="On refuses new projects and shows the notice below; finished videos, history and downloads stay reachable." checked={maintenanceMode} onChange={setMaintenanceMode} />
            <Field id="cr-maint-msg" label="Maintenance notice" hint="What members read while maintenance is on. Up to 300 characters.">
              <textarea id="cr-maint-msg" rows={2} maxLength={300} value={maintenanceMessage} onChange={(e) => setMaintenanceMessage(e.target.value)} className={cn(input, "min-h-[3.5rem] resize-y")} />
            </Field>
          </div>
          <p className="mt-5 text-xs font-semibold text-muted-foreground">Provider cost protection — a price under the margin refuses to save unless overridden; members never see any of it</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            <Field id="cr-guard-margin" label="Minimum margin (%)" hint="Every enabled per-second rate must clear the provider cost estimate by this much.">
              <input id="cr-guard-margin" type="number" inputMode="decimal" min={0} max={1000} step="any" value={guardMargin} onChange={(e) => setGuardMargin(e.target.value)} className={input} />
            </Field>
            <Field id="cr-guard-min" label="Minimum customer price (per video)" hint="The minimum charge may not sit under this. Zero disables it.">
              <input id="cr-guard-min" type="number" inputMode="decimal" min={0} step="any" value={guardMinPrice} onChange={(e) => setGuardMinPrice(e.target.value)} className={input} />
            </Field>
            <div className="sm:pt-6">
              <Toggle label="Allow prices below the minimum margin" hint="An explicit override for a promotion or a test. Recorded in the audit log like every other change." checked={guardOverride} onChange={setGuardOverride} />
            </div>
          </div>
          <p className="mt-5 text-xs font-semibold text-muted-foreground">Limits — 0 means no cap of that kind</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            <Field id="cr-lim-user" label="Active videos per member" hint="Counted at Start across running videos. The plan's own cap (1–3) still applies; this can only tighten it.">
              <input id="cr-lim-user" type="number" inputMode="numeric" min={0} max={100} value={maxActiveUser} onChange={(e) => setMaxActiveUser(e.target.value)} className={input} />
            </Field>
            <Field id="cr-lim-global" label="Active videos across FrenzSave" hint="Past this, Start answers 'busy, try again in a few minutes' and charges nothing.">
              <input id="cr-lim-global" type="number" inputMode="numeric" min={0} max={10_000} value={maxActiveGlobal} onChange={(e) => setMaxActiveGlobal(e.target.value)} className={input} />
            </Field>
            <Field id="cr-lim-day" label="Videos per member per day" hint="Starts in the last 24 hours.">
              <input id="cr-lim-day" type="number" inputMode="numeric" min={0} max={10_000} value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} className={input} />
            </Field>
          </div>
          <p className="mt-5 text-xs font-semibold text-muted-foreground">Provider circuit breaker</p>
          <div className="mt-2 space-y-4">
            <Toggle label="Pause a model that keeps failing" hint="After the failure count inside the window, new starts needing that model are refused (nothing charged) and paid jobs wait, until the pause passes. The Providers tab shows the state." checked={breakerEnabled} onChange={setBreakerEnabled} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="cr-brk-n" label="Failures before pausing" hint="1 to 1,000.">
                <input id="cr-brk-n" type="number" inputMode="numeric" min={1} max={1000} value={breakerThreshold} onChange={(e) => setBreakerThreshold(e.target.value)} className={input} />
              </Field>
              <Field id="cr-brk-w" label="Counted within (minutes)" hint="1 to 1,440.">
                <input id="cr-brk-w" type="number" inputMode="numeric" min={1} max={1440} value={breakerWindow} onChange={(e) => setBreakerWindow(e.target.value)} className={input} />
              </Field>
              <Field id="cr-brk-c" label="Pause for (minutes)" hint="1 to 1,440. The next try after the pause is the probe.">
                <input id="cr-brk-c" type="number" inputMode="numeric" min={1} max={1440} value={breakerCooldown} onChange={(e) => setBreakerCooldown(e.target.value)} className={input} />
              </Field>
            </div>
          </div>
        </Group>

        {/* ── RETENTION (Part 7 §21) ── */}
        <Group title="Retention">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="cr-ret-hours" label="Finished videos are kept for (hours)" hint="Then the files are removed and the row reads 'no longer available'. 1 to 720.">
              <input id="cr-ret-hours" type="number" inputMode="numeric" min={1} max={720} value={resultHours} onChange={(e) => setResultHours(e.target.value)} className={input} />
            </Field>
            <Field id="cr-ret-days" label="Saved videos are kept for (days)" hint="A member who taps Save keeps the video this long from the save. 1 to 365.">
              <input id="cr-ret-days" type="number" inputMode="numeric" min={1} max={365} value={savedDays} onChange={(e) => setSavedDays(e.target.value)} className={input} />
            </Field>
          </div>
        </Group>

        {/* ── RECHARGE ── */}
        <Group title="Recharge">
          <p className="text-xs text-muted-foreground">
            Balances, prices and every amount a member types are in {settings.frenzAiCurrency} (Frenz AI tab). Paystack can collect in another currency: the
            member sees the {settings.frenzAiCurrency} amount here and the converted amount on the secure page, and the balance is credited in {settings.frenzAiCurrency}.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field id="cr-checkout-cur" label="Paystack collects in" hint={walletIsUsd ? "Your Paystack account's currency. Only a USD balance converts; a currency Paystack cannot process is refused at checkout." : `Applies only when the balance is in USD — today Paystack collects in ${settings.frenzAiCurrency}, the balance currency.`}>
              <select id="cr-checkout-cur" value={checkoutCurrency} onChange={(e) => setCheckoutCurrency(e.target.value as AiCurrency)} className={input}>
                {(Object.keys(AI_CURRENCIES) as AiCurrency[]).map((code) => (
                  <option key={code} value={code}>
                    {code} ({AI_CURRENCIES[code]})
                  </option>
                ))}
              </select>
            </Field>
            <Field id="cr-fx-markup" label="Markup on the live rate (%)" hint="Added on top of the market rate at checkout, 0–50. The provider bills in dollars and a naira account pays a spread to buy them; this covers it. At 0 you bear the spread.">
              <input id="cr-fx-markup" type="number" inputMode="decimal" min={0} max={50} step="0.1" value={fxMarkup} onChange={(e) => setFxMarkup(e.target.value)} className={input} />
            </Field>
            <Field
              id="cr-fx"
              label={`Fallback: one US dollar in ${rateSymbol}`}
              hint={
                walletIsUsd
                  ? "Used only if no live rate can be fetched (and none is remembered from the last week). Also the rate for the margin check below."
                  : "Used only to compare each tier's price with the provider's USD cost and warn when the margin is thin. Never shown to members. Leave empty to skip the check."
              }
            >
              <input id="cr-fx" type="number" inputMode="decimal" min={0} step="any" value={fxPerUsd} onChange={(e) => setFxPerUsd(e.target.value)} className={input} />
            </Field>
          </div>
          {walletIsUsd ? (
            <p className="mt-3 rounded-xl bg-secondary/60 px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
              {liveRate === "loading"
                ? "Fetching the live rate…"
                : liveRate === "failed"
                  ? "Couldn't read the live rate just now."
                  : !liveRate.applies
                    ? "No conversion: Paystack collects in the balance currency."
                    : liveRate.missing || !liveRate.rate
                      ? "No live, remembered or fallback rate — members cannot recharge until one exists."
                      : liveRate.rate.source === "manual"
                        ? `Live rate unavailable — charging at the fallback, ${formatCents(liveRate.rate.minorPerUsd, checkoutSymbol)} per $1.`
                        : `Live rate: ${formatCents(Math.round((liveRate.rate.marketPerUsd ?? 0) * 100), checkoutSymbol)} per $1 (${liveRate.rate.source === "stored" ? "remembered" : liveRate.rate.provider ?? "market"}${liveRate.rate.fetchedAt ? `, ${new Date(liveRate.rate.fetchedAt).toLocaleString()}` : ""}). With the ${liveRate.rate.markupPercent}% markup a member pays ${formatCents(liveRate.rate.minorPerUsd, checkoutSymbol)} per $1 — $5 is ${formatCents(liveRate.rate.minorPerUsd * 5, checkoutSymbol)}. Refreshed hourly; the rate is pinned to each payment when it starts.`}
            </p>
          ) : null}
          <p className="mt-4 text-xs font-semibold text-muted-foreground">Bounds, in {settings.frenzAiCurrency}</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <Field id="cr-topup-min" label="Minimum recharge">
              <input id="cr-topup-min" type="number" inputMode="decimal" min={1} step="any" value={minTopup} onChange={(e) => setMinTopup(e.target.value)} className={input} />
            </Field>
            <Field id="cr-topup-max" label="Maximum recharge">
              <input id="cr-topup-max" type="number" inputMode="decimal" min={1} step="any" value={maxTopup} onChange={(e) => setMaxTopup(e.target.value)} className={input} />
            </Field>
          </div>
          <p className="mt-4 text-xs font-semibold text-muted-foreground">Packages, in the order the sheet shows them</p>
          <div className="mt-2 space-y-2">
            {packages.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="checkbox" aria-label={`Package ${i + 1} on`} checked={p.enabled} onChange={(e) => setPackages((ps) => ps.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
                <span className="text-sm text-muted-foreground">{symbol}</span>
                <input type="number" inputMode="decimal" min={1} step="any" aria-label={`Package ${i + 1} amount`} value={p.amount} onChange={(e) => setPackages((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className={cn(input, "mt-0 max-w-[10rem]")} />
                <button type="button" onClick={() => setPackages((ps) => ps.filter((_, j) => j !== i))} className="text-xs font-semibold text-muted-foreground hover:text-rose-500">
                  Remove
                </button>
              </div>
            ))}
            {packages.length < 12 ? (
              <button type="button" onClick={() => setPackages((ps) => [...ps, { amount: "", enabled: true }])} className="text-xs font-semibold text-primary">
                + Add a package
              </button>
            ) : null}
          </div>
        </Group>

        {problems.length > 0 ? (
          <ul className="space-y-1 rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-sm text-rose-600">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}

        {confirming ? (
          <div role="alertdialog" aria-labelledby="cr-confirm-title" className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.08] px-4 py-3">
            <p id="cr-confirm-title" className="flex items-center gap-2 text-sm font-bold">
              <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden /> Please check these before saving
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {confirming.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            {priceChanged ? (
              <Field id="cr-reason" label="Reason for the price change (recorded in the pricing history)" className="mt-3">
                <input id="cr-reason" type="text" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. provider cost went up" className={input} />
              </Field>
            ) : null}
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={busy} onClick={() => void submit()} className="btn-lux btn-lux-primary">
                {busy ? "Saving…" : "Save anyway"}
              </button>
              <button type="button" onClick={() => setConfirming(null)} className="btn-lux border border-border bg-background text-foreground">
                Go back
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy || problems.length > 0} className="btn-lux btn-lux-primary disabled:opacity-50">
            {busy ? "Saving…" : "Save pricing"}
          </button>
          {msg ? <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-500")}>{msg.text}</p> : null}
        </div>
      </form>

    </section>
  );
}

/* ───────────────────────────── pieces ────────────────────────────────────── */

/** One mode's form state → the route's shape. Empty boxes keep the stored value. */
function modePayload(
  st: { enabled: boolean; basePrice: string; tiers: { id: "standard" | "high" | "ultra"; enabled: boolean; perSecond: string }[]; maxSeconds: string; maxUploadMb: string; maxPixels: string; maxReferences: string; providerCostUsd: string; model: string },
  before: ReplacementModeConfig,
) {
  return {
    enabled: st.enabled,
    basePriceCents: majorInputToMinor(st.basePrice) ?? before.basePriceCents,
    tiers: st.tiers.map((t) => ({ id: t.id, enabled: t.enabled, perSecondCents: majorInputToMinor(t.perSecond) ?? before.tiers.find((b) => b.id === t.id)?.perSecondCents ?? 0 })),
    maximumDurationSeconds: st.maxSeconds.trim() === "" ? before.maximumDurationSeconds : Math.floor(Number(st.maxSeconds)),
    maximumUploadBytes: st.maxUploadMb.trim() === "" ? before.maximumUploadBytes : Math.floor(Number(st.maxUploadMb)) * 1024 * 1024,
    maximumPixels: st.maxPixels.trim() === "" ? before.maximumPixels : Math.floor(Number(st.maxPixels)),
    maximumReferenceImages: st.maxReferences.trim() === "" ? before.maximumReferenceImages : Math.floor(Number(st.maxReferences)),
    providerCostPerSecondUsdCents: st.providerCostUsd.trim() === "" ? before.providerCostPerSecondUsdCents : Math.max(0, Number(st.providerCostUsd) * 100),
    provider: { model: st.model.trim() || before.provider.model },
  };
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    /*
      `min-w-0`: a fieldset's default is `min-width: min-content`, so one wide
      child (the price table) pushed the whole group — and the page — past a
      phone's edge (owner, 2026-09-15, screenshot with the paragraph cut off).
    */
    <fieldset className="min-w-0 rounded-2xl border border-border/70 bg-background/40 p-4 sm:p-5">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ id, label, hint, className, children }: { id: string; label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={id} className={cn("block", className)}>
      <span className="block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground/80">{hint}</span> : null}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
