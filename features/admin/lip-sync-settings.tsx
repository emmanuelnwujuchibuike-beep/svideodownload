"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { KLING_VOICES_PUBLIC } from "@/lib/ai/lip-sync/voices-public";
import { LIP_SYNC_AUDIO_FORMATS, LIP_SYNC_BOUNDS, LIP_SYNC_DURATION_POLICIES, LIP_SYNC_EXPRESSIONS, type LipSyncDurationPolicy, type LipSyncExpression, type LipSyncProConfig } from "@/lib/ai/lip-sync/config";
import type { LipSyncAdminStats } from "@/lib/ai/lip-sync/admin";
import { formatCents } from "@/lib/ai/economy";
import { aiCurrencySymbol, majorInputToMinor, minorToMajorInput } from "@/lib/landing/bounds";
import type { LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI → LIP SYNC — the Kling price card, the two speech sources,
 *  the limits, the voice, the presets, the mismatch policy, the prices (§13)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 2026-10-05 (Part 8 §3, §4, §71): KLING ONLY. The Replicate / fal.ai switch and
 * their model cards are gone — every job already ran on the direct Kling
 * endpoint, while members were priced from the Replicate card. The Kling card
 * below is now the price the quote reads (owner's decision). Text to Speech is
 * ElevenLabs — shown, not switchable.
 *
 * Posts ONLY `frenzAiLipSync`. Lazy-loaded (frenz-ai-settings-lazy.tsx).
 */
const int = (raw: string, fallback: number) => {
  const n = Math.floor(Number(raw));
  return raw.trim() === "" || !Number.isFinite(n) ? fallback : n;
};
const num = (raw: string, fallback: number) => {
  const n = Number(raw);
  return raw.trim() === "" || !Number.isFinite(n) ? fallback : n;
};

export function LipSyncSettingsPanel({ settings, stats, voices, languages }: { settings: LandingSettings; stats: LipSyncAdminStats | null; voices: { id: string; label: string; provider: string }[]; languages: { code: string; label: string }[] }) {
  const router = useRouter();
  const cfg: LipSyncProConfig = settings.frenzAiLipSync;
  const symbol = aiCurrencySymbol(settings.frenzAiCurrency);
  const [enabled, setEnabled] = useState(cfg.enabled);
  const k = cfg.models.kling;
  const [kling, setKling] = useState({ enabled: k.enabled, perSecond: minorToMajorInput(k.perSecondCents), cost: String(k.providerCostPerSecondUsdCents), mult: String(k.creditMultiplier), conc: String(k.maxConcurrent), notes: k.notes });
  const setK = (patch: Partial<typeof kling>) => setKling((cur) => ({ ...cur, ...patch }));
  const [textOn, setTextOn] = useState(cfg.textMode.enabled);
  const [minChars, setMinChars] = useState(String(cfg.textMode.minimumCharacters));
  const [maxChars, setMaxChars] = useState(String(cfg.textMode.maximumCharacters));
  const [speedMin, setSpeedMin] = useState(String(cfg.textMode.speed.min));
  const [speedMax, setSpeedMax] = useState(String(cfg.textMode.speed.max));
  const [speedDefault, setSpeedDefault] = useState(String(cfg.textMode.speed.default));
  const [audioOn, setAudioOn] = useState(cfg.audioMode.enabled);
  const [formats, setFormats] = useState<string[]>([...cfg.audioMode.formats]);
  const [audioMax, setAudioMax] = useState(String(cfg.audioMode.maximumDurationSeconds));
  const [audioBytes, setAudioBytes] = useState(String(Math.round(cfg.audioMode.maximumUploadBytes / (1024 * 1024))));
  const [videoMax, setVideoMax] = useState(String(cfg.video.maximumDurationSeconds));
  const [videoMin, setVideoMin] = useState(String(cfg.video.minimumDurationSeconds));
  const [videoBytes, setVideoBytes] = useState(String(Math.round(cfg.video.maximumUploadBytes / (1024 * 1024))));
  const [ttsModel, setTtsModel] = useState(cfg.tts.model);
  const [ttsRequest, setTtsRequest] = useState(minorToMajorInput(cfg.tts.perRequestCents));
  const [ttsChar, setTtsChar] = useState(String(cfg.tts.perCharacterCents));
  const [ttsCost, setTtsCost] = useState(String(cfg.tts.providerCostPerCharacterUsdCents));
  const [voiceIds, setVoiceIds] = useState<string[]>([...cfg.voiceIds]);
  const [languageCodes, setLanguageCodes] = useState<string[]>([...cfg.languageCodes]);
  const [exprOn, setExprOn] = useState(cfg.expression.enabled);
  const [exprDefault, setExprDefault] = useState<LipSyncExpression>(cfg.expression.default);
  const [temps, setTemps] = useState<Record<LipSyncExpression, string>>({ natural: String(cfg.expression.temperature.natural), balanced: String(cfg.expression.temperature.balanced), expressive: String(cfg.expression.temperature.expressive) });
  const [speakerOn, setSpeakerOn] = useState(cfg.activeSpeaker.enabled);
  const [speakerDefault, setSpeakerDefault] = useState(cfg.activeSpeaker.default);
  const [policy, setPolicy] = useState<LipSyncDurationPolicy>(cfg.duration.policy);
  const [mismatch, setMismatch] = useState(String(Math.round(cfg.duration.significantMismatchFraction * 100)));
  const [syncMode, setSyncMode] = useState(cfg.duration.providerSyncMode);
  const [basePrice, setBasePrice] = useState(minorToMajorInput(cfg.basePriceCents));
  const [minCharge, setMinCharge] = useState(minorToMajorInput(cfg.minimumChargeCents));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const payload = {
        enabled,
        // Kling only — the server refuses a provider or a Replicate / fal card.
        models: { kling: { enabled: kling.enabled, perSecondCents: (majorInputToMinor(kling.perSecond) ?? k.perSecondCents), providerCostPerSecondUsdCents: num(kling.cost, 0), creditMultiplier: num(kling.mult, 1), maxConcurrent: int(kling.conc, 0), notes: kling.notes } },
        textMode: { enabled: textOn, minimumCharacters: int(minChars, 1), maximumCharacters: int(maxChars, 1200), speed: { min: num(speedMin, 0.8), max: num(speedMax, 2), default: num(speedDefault, 1) } },
        audioMode: { enabled: audioOn, formats, maximumDurationSeconds: int(audioMax, 120), maximumUploadBytes: int(audioBytes, 25) * 1024 * 1024 },
        video: { maximumDurationSeconds: int(videoMax, 60), minimumDurationSeconds: int(videoMin, 1), maximumUploadBytes: int(videoBytes, 50) * 1024 * 1024 },
        tts: { model: ttsModel.trim(), perRequestCents: (majorInputToMinor(ttsRequest) ?? cfg.tts.perRequestCents), perCharacterCents: num(ttsChar, 0), providerCostPerCharacterUsdCents: num(ttsCost, 0) },
        voiceIds,
        languageCodes,
        expression: { enabled: exprOn, default: exprDefault, temperature: { natural: num(temps.natural, 0.3), balanced: num(temps.balanced, 0.5), expressive: num(temps.expressive, 0.8) } },
        activeSpeaker: { enabled: speakerOn, default: speakerDefault },
        duration: { policy, significantMismatchFraction: Math.min(1, Math.max(0, num(mismatch, 15) / 100)), providerSyncMode: syncMode },
        basePriceCents: (majorInputToMinor(basePrice) ?? cfg.basePriceCents),
        minimumChargeCents: (majorInputToMinor(minCharge) ?? cfg.minimumChargeCents),
      };
      const res = await fetch("/api/admin/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frenzAiLipSync: payload }) });
      const json = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: "Saved. New quotes use this; a quote already given keeps its price." } : { ok: false, text: json.error ?? "Failed to save." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const select = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const usd = (c: number | null) => (c === null ? "—" : `$${(c / 100).toFixed(2)}`);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Lip Sync Pro</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          A video and ONE speech source — typed text, or the member&apos;s own audio. Text becomes ElevenLabs speech first; audio goes straight to Kling. Provider: Kling (direct lip-sync endpoint) — fixed, not switchable.
        </p>
        <div className="space-y-5">
          <Toggle label="Offer Lip Sync Pro" hint="Off: the door on the Explore page says so; nothing can be created." checked={enabled} onChange={setEnabled} />

          {/* ── the price: Kling's card, the one the quote reads ─────────────── */}
          <div className="rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">Kling lip sync — price</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Provider: Kling · Pipeline: direct lip-sync endpoint (kling-lip-sync). Members are quoted this rate × the video&apos;s seconds, plus the per-video price below.</p>
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Field label={`Price / second (${symbol})`}><input inputMode="decimal" value={kling.perSecond} onChange={(e) => setK({ perSecond: e.target.value })} className={input} /></Field>
              <Field label="Kling cost / s (US ¢)" hint="Estimate basis. 0 = unknown."><input inputMode="decimal" value={kling.cost} onChange={(e) => setK({ cost: e.target.value })} className={input} /></Field>
              <Field label="Credit multiplier" hint={`${LIP_SYNC_BOUNDS.creditMultiplier.min}–${LIP_SYNC_BOUNDS.creditMultiplier.max}; 1 = the same credits as any tool.`}><input inputMode="decimal" value={kling.mult} onChange={(e) => setK({ mult: e.target.value })} className={input} /></Field>
              <Field label="Max concurrent" hint="0 = the member/global caps only."><input inputMode="numeric" value={kling.conc} onChange={(e) => setK({ conc: e.target.value })} className={input} /></Field>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={kling.enabled} onChange={(e) => setK({ enabled: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]" /> enabled
            </label>
            <Field label="Notes"><input value={kling.notes} onChange={(e) => setK({ notes: e.target.value })} className={input} maxLength={400} /></Field>
          </div>

          {/* ── the two speech sources ─────────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/70 p-4">
              <Toggle label="Text mode" hint="Members type what the person says. A text-native model speaks it; any other model gets ElevenLabs speech first." checked={textOn} onChange={setTextOn} />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="Min characters"><input inputMode="numeric" value={minChars} onChange={(e) => setMinChars(e.target.value)} className={input} /></Field>
                <Field label="Max characters"><input inputMode="numeric" value={maxChars} onChange={(e) => setMaxChars(e.target.value)} className={input} /></Field>
                <Field label="Speed min (×)"><input inputMode="decimal" value={speedMin} onChange={(e) => setSpeedMin(e.target.value)} className={input} /></Field>
                <Field label="Speed max (×)"><input inputMode="decimal" value={speedMax} onChange={(e) => setSpeedMax(e.target.value)} className={input} /></Field>
                <Field label="Speed default (×)"><input inputMode="decimal" value={speedDefault} onChange={(e) => setSpeedDefault(e.target.value)} className={input} /></Field>
              </div>
              <div className="mt-3 rounded-xl bg-muted/40 p-3">
                <p className="flex items-center gap-2 text-xs font-semibold">
                  Text to Speech provider <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-bold uppercase text-background">ElevenLabs · locked</span>
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label="TTS model" hint="elevenlabs/<model id>"><input value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} className={input} /></Field>
                  <Field label={`Per request (${symbol})`}><input inputMode="decimal" value={ttsRequest} onChange={(e) => setTtsRequest(e.target.value)} className={input} /></Field>
                  <Field label="Per character (minor units)"><input inputMode="decimal" value={ttsChar} onChange={(e) => setTtsChar(e.target.value)} className={input} /></Field>
                  <Field label="Provider cost / char (US ¢)"><input inputMode="decimal" value={ttsCost} onChange={(e) => setTtsCost(e.target.value)} className={input} /></Field>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">Charged only when the voice provider does the work — never for uploaded audio, never for a text-native model.</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="Voices offered" hint="None ticked = every enabled voice.">
                  <div className="mt-1 max-h-32 space-y-1 overflow-auto rounded-xl border border-border p-2 text-xs">
                    {voices.map((v) => (
                      <label key={v.id} className="flex items-center gap-2">
                        <input type="checkbox" checked={voiceIds.includes(v.id)} onChange={(e) => setVoiceIds((ids) => (e.target.checked ? [...ids, v.id] : ids.filter((x) => x !== v.id)))} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" />
                        {v.label} <span className="text-muted-foreground">· {v.provider}</span>
                      </label>
                    ))}
                    {KLING_VOICES_PUBLIC.map((v) => (
                      <label key={v.id} className="flex items-center gap-2">
                        <input type="checkbox" checked={voiceIds.includes(v.id)} onChange={(e) => setVoiceIds((ids) => (e.target.checked ? [...ids, v.id] : ids.filter((x) => x !== v.id)))} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" />
                        {v.label} <span className="text-muted-foreground">· Kling ({v.language})</span>
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Languages offered" hint="None ticked = every language the provider speaks.">
                  <div className="mt-1 max-h-32 space-y-1 overflow-auto rounded-xl border border-border p-2 text-xs">
                    {languages.map((l) => (
                      <label key={l.code} className="flex items-center gap-2">
                        <input type="checkbox" checked={languageCodes.includes(l.code)} onChange={(e) => setLanguageCodes((c) => (e.target.checked ? [...c, l.code] : c.filter((x) => x !== l.code)))} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" />
                        {l.label} <span className="text-muted-foreground">· {l.code}</span>
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
            </div>
            <div className="rounded-2xl border border-border/70 p-4">
              <Toggle label="External audio mode" hint="Members upload their own recording — the authoritative track, never re-voiced." checked={audioOn} onChange={setAudioOn} />
              <div className="mt-3 flex flex-wrap gap-2">
                {LIP_SYNC_AUDIO_FORMATS.map((f) => (
                  <label key={f.id} className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs">
                    <input type="checkbox" checked={formats.includes(f.id)} onChange={(e) => setFormats((all) => (e.target.checked ? [...all, f.id] : all.filter((x) => x !== f.id)))} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" />
                    {f.label}
                  </label>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="Max audio (s)"><input inputMode="numeric" value={audioMax} onChange={(e) => setAudioMax(e.target.value)} className={input} /></Field>
                <Field label="Max audio file (MB)"><input inputMode="numeric" value={audioBytes} onChange={(e) => setAudioBytes(e.target.value)} className={input} /></Field>
                <Field label="Max video (s)" hint="A text-native model may cap this lower (Kling: 10 s)."><input inputMode="numeric" value={videoMax} onChange={(e) => setVideoMax(e.target.value)} className={input} /></Field>
                <Field label="Min video (s)"><input inputMode="numeric" value={videoMin} onChange={(e) => setVideoMin(e.target.value)} className={input} /></Field>
                <Field label="Max video file (MB)"><input inputMode="numeric" value={videoBytes} onChange={(e) => setVideoBytes(e.target.value)} className={input} /></Field>
              </div>
              <div className="mt-4 space-y-3">
                <Toggle label="Expression presets" hint="Natural · Balanced · Expressive — shown only when the active model has a temperature knob." checked={exprOn} onChange={setExprOn} />
                <div className="grid grid-cols-4 gap-2">
                  <Field label="Default">
                    <select value={exprDefault} onChange={(e) => setExprDefault(e.target.value as LipSyncExpression)} className={select}>
                      {LIP_SYNC_EXPRESSIONS.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {LIP_SYNC_EXPRESSIONS.map((x) => (
                    <Field key={x} label={`${x} → temp`}><input inputMode="decimal" value={temps[x]} onChange={(e) => setTemps((t) => ({ ...t, [x]: e.target.value }))} className={input} /></Field>
                  ))}
                </div>
                <Toggle label="Active speaker detection" hint="Shown only when the active model can detect the speaker (Sync Labs on Replicate)." checked={speakerOn} onChange={setSpeakerOn} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={speakerDefault} onChange={(e) => setSpeakerDefault(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" /> on by default
                </label>
              </div>
            </div>
          </div>

          {/* ── the mismatch policy and the prices ─────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/70 p-4">
              <p className="text-sm font-semibold">When the speech and the video differ in length</p>
              <Field label="Policy">
                <select value={policy} onChange={(e) => setPolicy(e.target.value as LipSyncDurationPolicy)} className={select}>
                  {LIP_SYNC_DURATION_POLICIES.map((p) => (
                    <option key={p} value={p}>
                      {p === "trim_video_to_audio" ? "Trim the video to the speech" : p === "trim_audio_to_video" ? "Trim the speech to the video" : p === "loop_audio" ? "Loop the speech (models with sync modes)" : p === "reject" ? "Reject a significant mismatch" : "Leave the rest to the model's sync mode"}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Significant mismatch (%)" hint="Below this, the residual is handled quietly."><input inputMode="numeric" value={mismatch} onChange={(e) => setMismatch(e.target.value)} className={input} /></Field>
                <Field label="Model sync mode" hint="silence · loop · bounce (never cut_off / remap)">
                  <select value={syncMode} onChange={(e) => setSyncMode(e.target.value as "silence" | "loop" | "bounce")} className={select}>
                    <option value="silence">silence</option>
                    <option value="loop">loop</option>
                    <option value="bounce">bounce</option>
                  </select>
                </Field>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Longer speech is always cut to the priced video length; it is never stretched. What was decided is written on the job.</p>
            </div>
            <div className="rounded-2xl border border-border/70 p-4">
              <p className="text-sm font-semibold">Prices</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label={`Per video (${symbol})`}><input inputMode="decimal" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} className={input} /></Field>
                <Field label={`Minimum charge (${symbol})`}><input inputMode="decimal" value={minCharge} onChange={(e) => setMinCharge(e.target.value)} className={input} /></Field>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Credits come from the AI Plans &amp; Credits conversion of the priced total; the model&apos;s credit multiplier above tilts it. Pricing version {cfg.pricingVersion}.</p>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={submit} disabled={busy} className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50">
            {busy ? "Saving…" : "Save Lip Sync Pro"}
          </button>
          {msg ? <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-600")}>{msg.text}</p> : null}
        </div>
      </section>

      {/* ── the numbers (§13) ──────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Lip Sync Pro · last {stats?.windowDays ?? 30} days</h2>
        <p className="mb-4 text-sm text-muted-foreground">Provider costs are the operator&apos;s ESTIMATES from the figures above; an actual figure appears only when a vendor reports one. The margin is shown only when revenue and cost share a currency.</p>
        {!stats ? (
          <p className="text-sm text-muted-foreground">No numbers yet.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Total jobs" value={String(stats.jobs)} />
            <Stat label="Text jobs" value={`${stats.textJobs}${stats.nativeTextJobs ? ` (${stats.nativeTextJobs} native)` : ""}`} />
            <Stat label="External audio jobs" value={String(stats.audioJobs)} />
            <Stat label="Completed / failed" value={`${stats.completed} / ${stats.failed}`} />
            <Stat label="Credits consumed" value={`${stats.creditsConsumed}${stats.creditsRefunded ? ` (${stats.creditsRefunded} back)` : ""}`} />
            <Stat label="TTS cost (est.)" value={usd(stats.ttsCostEstimateUsdCents)} />
            <Stat label="Lip-sync cost (est.)" value={usd(stats.lipSyncCostEstimateUsdCents)} />
            <Stat label="Total provider cost (est.)" value={usd(stats.totalCostEstimateUsdCents)} />
            <Stat label="Actual provider cost" value={stats.actualCostUsdCents === null ? "— (not reported)" : usd(stats.actualCostUsdCents)} />
            <Stat label="Revenue (settled wallets)" value={formatCents(stats.revenueCents, symbol)} />
            <Stat label="Gross margin" value={stats.grossMarginCents === null ? `— (${stats.currency} vs USD)` : formatCents(stats.grossMarginCents, symbol)} />
          </dl>
        )}
      </section>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
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
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-base font-bold tabular-nums">{value}</dd>
    </div>
  );
}
