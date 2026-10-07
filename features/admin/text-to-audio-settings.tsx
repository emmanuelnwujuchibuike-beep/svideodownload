"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatCents } from "@/lib/ai/economy";
import type { TextToAudioAdminStats } from "@/lib/ai/text-to-audio/admin";
import { TEXT_TO_AUDIO_MODEL_IDS, type TextToAudioConfig } from "@/lib/ai/text-to-audio/config";
import { TTS_DELIVERIES, TTS_DELIVERY_LABEL, voiceSettingsCapability } from "@/lib/ai/voice/voice-settings";
import { aiCurrencySymbol, majorInputToMinor, minorToMajorInput } from "@/lib/landing/bounds";
import type { LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI → TEXT TO AUDIO — the route switch, the model, the prices, the free
 *  characters, the Audio Library, the numbers
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "the text to speech should also switch to the Replicate
 * ElevenLabs v3 or the direct ElevenLabs API in the admin dashboard. The text
 * to audio should have a free of 500 characters a month to free and all sub
 * users." Both are the first two controls here.
 *
 * 2026-09-27 (owner): no further Replicate or fal.ai work — the DIRECT
 * ElevenLabs API is the default and the recommended route; the Replicate
 * route stays selectable only until the provider migration lands.
 *
 * Posts ONLY `frenzAiTextToAudio`. Lazy-loaded (frenz-ai-settings-lazy.tsx).
 */
const int = (raw: string, fallback: number) => {
  const n = Math.floor(Number(raw));
  return raw.trim() === "" || !Number.isFinite(n) ? fallback : n;
};
const num = (raw: string, fallback: number) => {
  const n = Number(raw);
  return raw.trim() === "" || !Number.isFinite(n) ? fallback : n;
};

const MODEL_LABEL: Record<string, string> = {
  "elevenlabs/eleven_v3": "ElevenLabs v3 — direct API, most expressive, 70+ languages",
  "elevenlabs/eleven_multilingual_v2": "ElevenLabs Multilingual v2 — direct API, stable",
  "elevenlabs/eleven_turbo_v2_5": "ElevenLabs Turbo v2.5 — direct API, fast (40k characters)",
  "elevenlabs/eleven_flash_v2_5": "ElevenLabs Flash v2.5 — direct API, fastest (40k characters)",
};

export function TextToAudioSettingsPanel({ settings, stats, voices, languages }: { settings: LandingSettings; stats: TextToAudioAdminStats | null; voices: { id: string; label: string; provider: string }[]; languages: { code: string; label: string }[] }) {
  const router = useRouter();
  const cfg: TextToAudioConfig = settings.frenzAiTextToAudio;
  const symbol = aiCurrencySymbol(settings.frenzAiCurrency);
  const [enabled, setEnabled] = useState(cfg.enabled);
  /*
    Part 8 §42 (2026-10-05): the direct ElevenLabs API, always. The route switch
    and the Replicate card are gone and the server refuses both; the model
    choice below is still the admin's (the live row stays on whatever it is).
  */
  const route = "elevenlabs" as const;
  const [models, setModels] = useState<Record<"elevenlabs", { model: string; enabled: boolean; perChar: string; perRequest: string; cost: string; quality: string; credit: string; notes: string }>>({
    elevenlabs: { model: cfg.models.elevenlabs.model, enabled: cfg.models.elevenlabs.enabled, perChar: String(cfg.models.elevenlabs.perCharacterCents), perRequest: minorToMajorInput(cfg.models.elevenlabs.perRequestCents), cost: String(cfg.models.elevenlabs.providerCostPerCharacterUsdCents), quality: String(cfg.models.elevenlabs.qualityMultiplier), credit: String(cfg.models.elevenlabs.creditMultiplier), notes: cfg.models.elevenlabs.notes },
  });
  const [minCharge, setMinCharge] = useState(minorToMajorInput(cfg.minimumChargeCents));
  const [maxChars, setMaxChars] = useState(String(cfg.maximumCharacters));
  const [minChars, setMinChars] = useState(String(cfg.minimumCharacters));
  const [freeChars, setFreeChars] = useState(String(cfg.freeCharactersPerMonth));
  // 0185: an AI plan's own monthly characters (blank = the same as Free) and the rule for a text longer than what is left
  const [proChars, setProChars] = useState(cfg.tierCharacters.ai_pro === null ? "" : String(cfg.tierCharacters.ai_pro));
  const [maxChars2, setMaxChars2] = useState(cfg.tierCharacters.ai_max === null ? "" : String(cfg.tierCharacters.ai_max));
  const [partialRule, setPartialRule] = useState(cfg.partialAllowance);
  const [voiceIds, setVoiceIds] = useState<string[]>([...cfg.voiceIds]);
  const [languageCodes, setLanguageCodes] = useState<string[]>([...cfg.languageCodes]);
  const [retention, setRetention] = useState(String(cfg.libraryRetentionDays));
  /* 2026-09-27: the delivery — the dials that had never been sent (lib/ai/voice/voice-settings.ts). */
  const [stability, setStability] = useState(String(cfg.voiceSettings.stability));
  const [similarity, setSimilarity] = useState(String(cfg.voiceSettings.similarityBoost));
  const [style, setStyle] = useState(String(cfg.voiceSettings.style));
  const [speakerBoost, setSpeakerBoost] = useState(cfg.voiceSettings.speakerBoost);
  const [speed, setSpeed] = useState(String(cfg.voiceSettings.speed));
  const [deliveryChoice, setDeliveryChoice] = useState(cfg.deliveryChoice);
  const [defaultDelivery, setDefaultDelivery] = useState(cfg.defaultDelivery);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const payload = {
        enabled,
        route,
        models: Object.fromEntries(
          (["elevenlabs"] as const).map((r) => [
            r,
            {
              model: models[r].model.trim(),
              enabled: models[r].enabled,
              perCharacterCents: num(models[r].perChar, cfg.models[r].perCharacterCents),
              perRequestCents: majorInputToMinor(models[r].perRequest) ?? cfg.models[r].perRequestCents,
              providerCostPerCharacterUsdCents: num(models[r].cost, 0),
              qualityMultiplier: num(models[r].quality, 1),
              creditMultiplier: num(models[r].credit, 1),
              notes: models[r].notes,
            },
          ]),
        ),
        minimumChargeCents: majorInputToMinor(minCharge) ?? cfg.minimumChargeCents,
        maximumCharacters: int(maxChars, cfg.maximumCharacters),
        minimumCharacters: int(minChars, cfg.minimumCharacters),
        freeCharactersPerMonth: int(freeChars, cfg.freeCharactersPerMonth),
        tierCharacters: { ai_pro: proChars.trim() === "" ? null : int(proChars, 0), ai_max: maxChars2.trim() === "" ? null : int(maxChars2, 0) },
        partialAllowance: partialRule,
        voiceIds,
        languageCodes,
        libraryRetentionDays: int(retention, cfg.libraryRetentionDays),
        voiceSettings: {
          stability: num(stability, cfg.voiceSettings.stability),
          similarityBoost: num(similarity, cfg.voiceSettings.similarityBoost),
          style: num(style, cfg.voiceSettings.style),
          speakerBoost,
          speed: num(speed, cfg.voiceSettings.speed),
        },
        deliveryChoice,
        defaultDelivery,
      };
      const res = await fetch("/api/admin/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frenzAiTextToAudio: payload }) });
      const json = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: "Saved. New generations use this; running ones keep the route they started on." } : { ok: false, text: json.error ?? "Failed to save." });
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
  const catalogue = voices.filter((v) => v.provider === "elevenlabs_api");
  /* Which dials the ACTIVE model reads — the same function the adapters clamp with, so the panel cannot claim otherwise. */
  const capability = voiceSettingsCapability(models[route].model);
  const modelReads = ["stability" + (capability.stabilityChoices.length ? ` (${capability.stabilityChoices.join(" / ")} only)` : ""), "similarity", capability.style ? "expressiveness" : null, capability.speakerBoost ? "speaker boost" : null, capability.speed ? "speed" : null].filter((x): x is string => !!x);
  const modelIgnores = [!capability.style ? "expressiveness" : null, !capability.speakerBoost ? "speaker boost" : null, !capability.speed ? "speed" : null].filter((x): x is string => !!x);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Text to Audio</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          A standalone tool: text in, audio out, saved to the member&apos;s Audio Library and reusable in Lip Sync Pro at no second charge. It never touches a video pipeline. Provider: ElevenLabs, direct API — fixed, not switchable.
        </p>
        <div className="space-y-5">
          <Toggle label="Offer Text to Audio" hint="Off: the Explore card says so and nothing can be generated." checked={enabled} onChange={setEnabled} />

          {/* ── the model and the price (direct ElevenLabs API) ──────────────── */}
          <div className="rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">ElevenLabs — direct API</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Synchronous: the audio comes back in the request. Needs ELEVENLABS_API_KEY and the account&apos;s imported voices.</p>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {(["elevenlabs"] as const).map((r) => {
                const m = models[r];
                const set = (patch: Partial<typeof m>) => setModels((all) => ({ ...all, [r]: { ...all[r], ...patch } }));
                return (
                  <div key={r} className={cn("rounded-2xl border p-3", route === r ? "border-foreground/40" : "border-border/60 opacity-90")}>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Direct API model</p>
                    <label className="mt-2 block text-xs font-semibold text-muted-foreground">
                      Model
                      <select value={m.model} onChange={(e) => set({ model: e.target.value })} className={select}>
                        {TEXT_TO_AUDIO_MODEL_IDS[r].map((id) => (
                          <option key={id} value={id}>
                            {MODEL_LABEL[id] ?? id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Field label={`Price / character (${symbol} minor units)`} hint="0.5 = half a minor unit per character.">
                        <input inputMode="decimal" value={m.perChar} onChange={(e) => set({ perChar: e.target.value })} className={input} />
                      </Field>
                      <Field label={`Per generation (${symbol})`}>
                        <input inputMode="decimal" value={m.perRequest} onChange={(e) => set({ perRequest: e.target.value })} className={input} />
                      </Field>
                      <Field label="Provider cost / char (US¢)" hint="Your estimate; the margin line uses it.">
                        <input inputMode="decimal" value={m.cost} onChange={(e) => set({ cost: e.target.value })} className={input} />
                      </Field>
                      <Field label="Quality multiplier">
                        <input inputMode="decimal" value={m.quality} onChange={(e) => set({ quality: e.target.value })} className={input} />
                      </Field>
                      <Field label="Credit multiplier">
                        <input inputMode="decimal" value={m.credit} onChange={(e) => set({ credit: e.target.value })} className={input} />
                      </Field>
                      <div className="flex items-end pb-1">
                        <Toggle label="Model on" hint="" checked={m.enabled} onChange={(v) => set({ enabled: v })} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── the free characters ────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">Included characters a month</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Per tier: a member on no AI plan gets the Free number; AI Pro and AI Max get their own (blank = the same as Free). Taken atomically at Generate and given back if the
              generation fails. When they run out, the rest is paid with credits — only after the member chooses to.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Free · characters / month">
                <input inputMode="numeric" value={freeChars} onChange={(e) => setFreeChars(e.target.value)} className={input} />
              </Field>
              <Field label="AI Pro · characters / month" hint="Blank = same as Free.">
                <input inputMode="numeric" value={proChars} onChange={(e) => setProChars(e.target.value)} className={input} />
              </Field>
              <Field label="AI Max · characters / month" hint="Blank = same as Free.">
                <input inputMode="numeric" value={maxChars2} onChange={(e) => setMaxChars2(e.target.value)} className={input} />
              </Field>
              <Field label="Text longer than what is left" hint="How the rest is paid for.">
                <select value={partialRule} onChange={(e) => setPartialRule(e.target.value as typeof partialRule)} className={input}>
                  <option value="ask">Ask the member each time</option>
                  <option value="split">Use what is left + credits for the rest</option>
                  <option value="all_credits">Credits for the whole text</option>
                </select>
              </Field>
              <Field label="Minimum charge" hint="Never applies to a generation the allowance covers in full.">
                <input inputMode="decimal" value={minCharge} onChange={(e) => setMinCharge(e.target.value)} className={input} />
              </Field>
              <Field label="Library retention (days)" hint="0 = keep for ever.">
                <input inputMode="numeric" value={retention} onChange={(e) => setRetention(e.target.value)} className={input} />
              </Field>
            </div>
          </div>

          {/* ── 2026-09-27 · how it is delivered ─────────────────────────────
              🔴 THE FIX FOR "SOUNDS LIKE AI". Owner, 2026-09-27: "i test the
              text to speech now and i think is not realistic enough, sounds
              like ai, isnt it the realistic multilingual v2 and v3?" It WAS v3.
              What was missing was this whole block: both adapters used to send
              the text and the model and nothing else, so every generation ran
              at the provider's conservative defaults with the expressiveness
              dial at ZERO — which is a reading, not a performance. */}
          <div className="rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">How the voice is delivered</p>
            <p className="mt-1 text-xs text-muted-foreground">
              These decide whether a generation sounds like a person or like a reading. Before 2026-09-27 none of them were sent, so every generation used the provider&apos;s defaults with{" "}
              <strong>expressiveness at zero</strong>. Lower stability = more variation and emotion; higher = steadier across a long text.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Field label="Stability (0–1)" hint="v3 takes only 0, 0.5 or 1 — the nearest is sent.">
                <input inputMode="decimal" value={stability} onChange={(e) => setStability(e.target.value)} className={input} />
              </Field>
              <Field label="Similarity (0–1)" hint="How closely it holds to the voice.">
                <input inputMode="decimal" value={similarity} onChange={(e) => setSimilarity(e.target.value)} className={input} />
              </Field>
              <Field label="Expressiveness (0–1)" hint="0 is a reading. Not read by v3.">
                <input inputMode="decimal" value={style} onChange={(e) => setStyle(e.target.value)} className={input} />
              </Field>
              <Field label="Speed (0.7–1.2)" hint="Turbo / Flash v2.5 only.">
                <input inputMode="decimal" value={speed} onChange={(e) => setSpeed(e.target.value)} className={input} />
              </Field>
              <Field label="Speaker boost" hint="Clarity toward the voice. Not read by v3.">
                <select value={speakerBoost ? "on" : "off"} onChange={(e) => setSpeakerBoost(e.target.value === "on")} className={select}>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </Field>
            </div>
            {/* What the ACTIVE model actually reads — so a number typed into a field this model ignores is not a mystery. */}
            <p className="mt-3 rounded-xl bg-secondary/60 px-3 py-2 text-[11px] text-muted-foreground">
              <strong>{models[route].model}</strong> reads {modelReads.join(", ")}.
              {modelIgnores.length ? ` It ignores ${modelIgnores.join(", ")} — those fields are left out of the request rather than sent.` : ""}
            </p>
            <div className="mt-4 space-y-3">
              <Toggle label="Let members choose the delivery" hint="Offers Natural / Expressive / Calm in the workspace. Off: every generation uses the numbers above." checked={deliveryChoice} onChange={setDeliveryChoice} />
              <Field label="Default delivery" hint="What a member gets before they choose — and what everyone gets when the choice is off.">
                <select value={defaultDelivery} onChange={(e) => setDefaultDelivery(e.target.value as typeof defaultDelivery)} className={select}>
                  {TTS_DELIVERIES.map((d) => (
                    <option key={d} value={d}>
                      {TTS_DELIVERY_LABEL[d].label} — {TTS_DELIVERY_LABEL[d].blurb}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          {/* ── the text ───────────────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Minimum characters">
              <input inputMode="numeric" value={minChars} onChange={(e) => setMinChars(e.target.value)} className={input} />
            </Field>
            <Field label="Maximum characters" hint="The active model's own ceiling still applies and is shown to the member.">
              <input inputMode="numeric" value={maxChars} onChange={(e) => setMaxChars(e.target.value)} className={input} />
            </Field>
          </div>

          {/* ── the catalogue ──────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">Voices offered</p>
            <p className="mt-1 text-xs text-muted-foreground">None ticked = every voice of the active route&apos;s provider. Voices come from the Character Replace catalogue; the direct API needs the account&apos;s imported ids.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {catalogue.length === 0 ? <p className="text-xs text-muted-foreground">No voice rows for this route yet — import the account&apos;s voices in AI → Character Replace.</p> : null}
              {catalogue.map((v) => {
                const on = voiceIds.includes(v.id);
                return (
                  <button key={v.id} type="button" onClick={() => setVoiceIds((ids) => (on ? ids.filter((x) => x !== v.id) : [...ids, v.id]))} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", on ? "border-foreground bg-foreground text-background" : "border-border")}>
                    {v.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-sm font-semibold">Languages offered</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {languages.map((l) => {
                const on = languageCodes.includes(l.code);
                return (
                  <button key={l.code} type="button" onClick={() => setLanguageCodes((c) => (on ? c.filter((x) => x !== l.code) : [...c, l.code]))} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", on ? "border-foreground bg-foreground text-background" : "border-border")}>
                    {l.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void save()} disabled={busy} className="rounded-full bg-foreground px-5 py-2.5 text-sm font-bold text-background disabled:opacity-50">
              {busy ? "Saving…" : "Save Text to Audio"}
            </button>
            {msg ? <span className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-600")}>{msg.text}</span> : null}
          </div>
        </div>
      </section>

      {/* ── the numbers ──────────────────────────────────────────────────── */}
      {stats ? (
        <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
          <h2 className="mb-1 font-semibold">Text to Audio · last {stats.windowDays} days</h2>
          <p className="mb-4 text-sm text-muted-foreground">Generations, characters, what the free allowance covered, and what it cost against what it earned. Margin is shown only when the AI currency is USD (the cost estimate is in US cents).</p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Generations" value={String(stats.jobs)} />
            <Stat label="Completed" value={String(stats.completed)} />
            <Stat label="Failed" value={String(stats.failed)} />
            <Stat label="Characters" value={stats.characters.toLocaleString("en-US")} />
            <Stat label="Free characters" value={stats.freeCharacters.toLocaleString("en-US")} />
            <Stat label="Billable characters" value={stats.billableCharacters.toLocaleString("en-US")} />
            <Stat label="Credits used" value={String(stats.creditsConsumed)} />
            <Stat label="Credits returned" value={String(stats.creditsRefunded)} />
            <Stat label="Wallet revenue" value={formatCents(stats.revenueCents, symbol)} />
            <Stat label="Cost estimate" value={usd(stats.costEstimateUsdCents)} />
            <Stat label="Cost reported" value={usd(stats.actualCostUsdCents)} />
            <Stat label="Gross margin" value={stats.grossMarginCents === null ? "— (USD only)" : formatCents(stats.grossMarginCents, symbol)} />
            <Stat label="Library items" value={String(stats.assets)} />
            <Stat label="Library size" value={`${(stats.assetBytes / (1024 * 1024)).toFixed(1)} MB`} />
            <Stat label="Members using the free allowance" value={String(stats.freeMembersThisMonth)} />
          </dl>
        </section>
      ) : null}
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
        {hint ? <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{hint}</span> : null}
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
