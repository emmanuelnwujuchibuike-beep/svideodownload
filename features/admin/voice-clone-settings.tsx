"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatCents } from "@/lib/ai/economy";
import type { VoiceCloneAdminStats } from "@/lib/ai/voice-clone/admin";
import { VOICE_CLONE_AUDIENCES, VOICE_CLONE_SAMPLE_FORMATS, type VoiceCloneConfig } from "@/lib/ai/voice-clone/config";
import { aiCurrencySymbol, majorInputToMinor, minorToMajorInput } from "@/lib/landing/bounds";
import type { LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI → VOICE CLONING — the slots, the price, the samples, the consent wording
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "next lets build the standalone voice cloning."
 *
 * ── 🔴 THE SLOTS ARE THE FIRST CONTROL, NOT THE PRICE ───────────────────────
 * Cloning costs the provider almost nothing per voice and then occupies a VOICE
 * SLOT on our account for as long as the voice exists. Slots are shared by every
 * member, so they are the thing that actually runs out — and when they do, every
 * member is refused at once through nobody's mistake. `Live voices` against the
 * account cap is the number to watch, and it is at the top of the figures for
 * that reason.
 *
 * Posts ONLY `frenzAiVoiceClone`. Lazy-loaded (frenz-ai-settings-lazy.tsx).
 */
const int = (raw: string, fallback: number) => {
  const n = Math.floor(Number(raw));
  return raw.trim() === "" || !Number.isFinite(n) ? fallback : n;
};
const num = (raw: string, fallback: number) => {
  const n = Number(raw);
  return raw.trim() === "" || !Number.isFinite(n) ? fallback : n;
};
const mb = (bytes: number) => String(Math.round((bytes / (1024 * 1024)) * 10) / 10);
const toBytes = (raw: string, fallback: number) => {
  const n = Number(raw);
  return raw.trim() === "" || !Number.isFinite(n) || n <= 0 ? fallback : Math.round(n * 1024 * 1024);
};

const AUDIENCE_LABEL: Record<string, string> = { free: "Free members", pro: "Pro", business: "Business", admin: "Admins" };

export function VoiceCloneSettingsPanel({ settings, stats }: { settings: LandingSettings; stats: VoiceCloneAdminStats | null }) {
  const router = useRouter();
  const cfg: VoiceCloneConfig = settings.frenzAiVoiceClone;
  const symbol = aiCurrencySymbol(settings.frenzAiCurrency);
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [perClone, setPerClone] = useState(minorToMajorInput(cfg.perCloneCents));
  const [minCharge, setMinCharge] = useState(minorToMajorInput(cfg.minimumChargeCents));
  const [cost, setCost] = useState(String(cfg.providerCostPerCloneUsdCents));
  const [creditMultiplier, setCreditMultiplier] = useState(String(cfg.creditMultiplier));
  const [freeClones, setFreeClones] = useState(String(cfg.freeClonesPerMonth));
  const [slots, setSlots] = useState<Record<string, string>>(Object.fromEntries(VOICE_CLONE_AUDIENCES.map((a) => [a, String(cfg.slots[a])])));
  const [accountCap, setAccountCap] = useState(String(cfg.accountVoiceCap));
  const [minSamples, setMinSamples] = useState(String(cfg.samples.minimum));
  const [maxSamples, setMaxSamples] = useState(String(cfg.samples.maximum));
  const [maxEach, setMaxEach] = useState(mb(cfg.samples.maximumBytes));
  const [maxTotal, setMaxTotal] = useState(mb(cfg.samples.maximumTotalBytes));
  const [minSeconds, setMinSeconds] = useState(String(cfg.samples.minimumSecondsTotal));
  const [maxSecondsEach, setMaxSecondsEach] = useState(String(cfg.samples.maximumSecondsEach));
  const [formats, setFormats] = useState<string[]>([...cfg.samples.formats]);
  const [retention, setRetention] = useState(String(cfg.sampleRetentionDays));
  const [consentStatement, setConsentStatement] = useState(cfg.consentStatement);
  const [requireConsentName, setRequireConsentName] = useState(cfg.requireConsentName);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const payload = {
        enabled,
        perCloneCents: majorInputToMinor(perClone) ?? cfg.perCloneCents,
        minimumChargeCents: majorInputToMinor(minCharge) ?? cfg.minimumChargeCents,
        providerCostPerCloneUsdCents: num(cost, cfg.providerCostPerCloneUsdCents),
        creditMultiplier: num(creditMultiplier, cfg.creditMultiplier),
        freeClonesPerMonth: int(freeClones, cfg.freeClonesPerMonth),
        slots: Object.fromEntries(VOICE_CLONE_AUDIENCES.map((a) => [a, int(slots[a] ?? "", cfg.slots[a])])),
        accountVoiceCap: int(accountCap, cfg.accountVoiceCap),
        samples: {
          minimum: int(minSamples, cfg.samples.minimum),
          maximum: int(maxSamples, cfg.samples.maximum),
          maximumBytes: toBytes(maxEach, cfg.samples.maximumBytes),
          maximumTotalBytes: toBytes(maxTotal, cfg.samples.maximumTotalBytes),
          minimumSecondsTotal: int(minSeconds, cfg.samples.minimumSecondsTotal),
          maximumSecondsEach: int(maxSecondsEach, cfg.samples.maximumSecondsEach),
          formats,
        },
        sampleRetentionDays: int(retention, cfg.sampleRetentionDays),
        consentStatement: consentStatement.trim() || cfg.consentStatement,
        requireConsentName,
      };
      const res = await fetch("/api/admin/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frenzAiVoiceClone: payload }) });
      const json = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: "Saved. New voices use this; voices already made keep the consent wording they were made under." } : { ok: false, text: json.error ?? "Failed to save." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const capacity = stats && cfg.accountVoiceCap > 0 ? Math.round((stats.liveVoices / cfg.accountVoiceCap) * 100) : null;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Voice Cloning</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          A standalone tool: a member&apos;s own recordings become a voice they can type with in Text to Audio and Lip Sync Pro. Made by the direct ElevenLabs API — no prediction, no webhook, no worker. Every voice occupies a
          voice slot on the provider account until somebody deletes it.
        </p>
        <div className="space-y-5">
          <Toggle label="Offer Voice Cloning" hint="Off: the Explore card says so, nothing can be cloned, and existing voices stay usable." checked={enabled} onChange={setEnabled} />

          {/* ── the slots ─────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">Voice slots</p>
            <p className="mt-1 text-xs text-muted-foreground">
              How many LIVE voices one member may keep, and how many everybody may hold together. The account cap protects the provider account&apos;s own voice limit — when it fills, every member is refused at once.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {VOICE_CLONE_AUDIENCES.map((a) => (
                <Field key={a} label={AUDIENCE_LABEL[a] ?? a}>
                  <input inputMode="numeric" value={slots[a] ?? ""} onChange={(e) => setSlots((s) => ({ ...s, [a]: e.target.value }))} className={input} />
                </Field>
              ))}
              <Field label="Account cap (all members)" hint="0 = no cap. Keep headroom under the provider's limit.">
                <input inputMode="numeric" value={accountCap} onChange={(e) => setAccountCap(e.target.value)} className={input} />
              </Field>
            </div>
            {capacity !== null && stats ? (
              <p className={cn("mt-3 rounded-xl px-3 py-2 text-[11px]", capacity >= 85 ? "bg-rose-500/10 font-semibold text-rose-700 dark:text-rose-300" : "bg-secondary/60 text-muted-foreground")}>
                {stats.liveVoices} of {cfg.accountVoiceCap} account slots in use ({capacity}%). {stats.unusedVoices} have never been spoken with; {stats.staleVoices} not in 30 days.
                {capacity >= 85 ? " Raise the cap or reclaim slots before members start being refused." : ""}
              </p>
            ) : null}
          </div>

          {/* ── the price ─────────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">Price</p>
            <p className="mt-1 text-xs text-muted-foreground">One price per voice — not per second of audio. A member who gives more audio gets a better voice, so the thing that improves the result is deliberately not billed.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field label={`Per voice (${symbol})`}>
                <input inputMode="decimal" value={perClone} onChange={(e) => setPerClone(e.target.value)} className={input} />
              </Field>
              <Field label={`Minimum charge (${symbol})`} hint="Never applies to a voice the allowance covers.">
                <input inputMode="decimal" value={minCharge} onChange={(e) => setMinCharge(e.target.value)} className={input} />
              </Field>
              <Field label="Free voices / member / month" hint="0 = none.">
                <input inputMode="numeric" value={freeClones} onChange={(e) => setFreeClones(e.target.value)} className={input} />
              </Field>
              <Field label="Provider cost (US¢ / voice)" hint="Your estimate; for the margin figure only.">
                <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className={input} />
              </Field>
              <Field label="Credit multiplier" hint="0.1–10 on the credit price.">
                <input inputMode="decimal" value={creditMultiplier} onChange={(e) => setCreditMultiplier(e.target.value)} className={input} />
              </Field>
            </div>
          </div>

          {/* ── the samples ───────────────────────────────────────────────── */}
          <div className="rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">Recordings</p>
            <p className="mt-1 text-xs text-muted-foreground">
              What a member may upload. The minimum seconds is measured in their browser and is advice rather than a wall — a file whose length cannot be read is never held against them; the counts and the bytes are enforced by
              storage.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Minimum files">
                <input inputMode="numeric" value={minSamples} onChange={(e) => setMinSamples(e.target.value)} className={input} />
              </Field>
              <Field label="Maximum files">
                <input inputMode="numeric" value={maxSamples} onChange={(e) => setMaxSamples(e.target.value)} className={input} />
              </Field>
              <Field label="Max MB each">
                <input inputMode="decimal" value={maxEach} onChange={(e) => setMaxEach(e.target.value)} className={input} />
              </Field>
              <Field label="Max MB together">
                <input inputMode="decimal" value={maxTotal} onChange={(e) => setMaxTotal(e.target.value)} className={input} />
              </Field>
              <Field label="Minimum seconds total">
                <input inputMode="numeric" value={minSeconds} onChange={(e) => setMinSeconds(e.target.value)} className={input} />
              </Field>
              <Field label="Max seconds each">
                <input inputMode="numeric" value={maxSecondsEach} onChange={(e) => setMaxSecondsEach(e.target.value)} className={input} />
              </Field>
            </div>
            <p className="mt-4 text-sm font-semibold">Formats accepted</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {VOICE_CLONE_SAMPLE_FORMATS.map((f) => {
                const on = formats.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFormats((list) => (on ? list.filter((x) => x !== f.id) : [...list, f.id]))}
                    className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", on ? "border-foreground bg-foreground text-background" : "border-border")}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">An empty selection is read as the default set — a tool that accepts no format is a tool nobody can use.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="Keep recordings for (days)" hint="0 = as long as the voice lives. They are deleted with it either way.">
                <input inputMode="numeric" value={retention} onChange={(e) => setRetention(e.target.value)} className={input} />
              </Field>
            </div>
          </div>

          {/* ── the consent ───────────────────────────────────────────────────
              🔴 Stored PER VOICE, exactly as it was shown. Changing it here
              changes what the NEXT member agrees to; it never rewrites what
              somebody already agreed to. */}
          <div className="rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">The rights confirmation</p>
            <p className="mt-1 text-xs text-muted-foreground">
              A cloned voice is somebody&apos;s likeness. These words are shown before a voice is made and stored with it, so the record says what was agreed and when. Editing them affects new voices only.
            </p>
            <label className="mt-3 block">
              <span className="text-xs font-medium text-muted-foreground">Statement the member confirms</span>
              <textarea value={consentStatement} onChange={(e) => setConsentStatement(e.target.value)} rows={3} maxLength={600} className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </label>
            <div className="mt-3">
              <Toggle label="Require them to type their name" hint="A typed signature is a record; a ticked box on its own is weaker. On by default." checked={requireConsentName} onChange={setRequireConsentName} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-foreground px-5 text-sm font-semibold text-background disabled:opacity-50">
              {busy ? "Saving…" : "Save Voice Cloning settings"}
            </button>
            {msg ? <p className={cn("text-xs", msg.ok ? "text-emerald-600" : "text-rose-600")}>{msg.text}</p> : null}
          </div>
        </div>
      </section>

      {/* ── the figures ──────────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Voice Cloning · last {stats?.windowDays ?? 30} days</h2>
        <p className="mb-4 text-xs text-muted-foreground">Live voices are counted across ALL time, because a slot made three months ago is still a slot.</p>
        {!stats ? (
          <p className="text-sm text-muted-foreground">No figures yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label="Live voices" value={String(stats.liveVoices)} hint={`${stats.members} member${stats.members === 1 ? "" : "s"}`} />
            <Stat label="Never used" value={String(stats.unusedVoices)} hint="Reclaimable slots" />
            <Stat label="Not used in 30 days" value={String(stats.staleVoices)} />
            <Stat label="Voices made" value={String(stats.completed)} hint={`${stats.jobs} requests`} />
            <Stat label="Free this month" value={String(stats.freeMembersThisMonth)} hint={`${stats.freeVoices} covered`} />
            <Stat label="Refused by the provider" value={String(stats.rejected)} hint={`${stats.failed} failed in total`} />
            <Stat label="Revenue" value={formatCents(stats.revenueCents, symbol)} />
            <Stat label="Credits used" value={String(stats.creditsConsumed)} hint={`${stats.creditsRefunded} refunded`} />
            <Stat label="Provider cost (est.)" value={`$${(stats.costEstimateUsdCents / 100).toFixed(2)}`} />
            <Stat label="Recordings stored" value={`${(stats.sampleBytes / (1024 * 1024)).toFixed(1)} MB`} />
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border/70 px-3 py-2.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums tracking-[-0.02em]">{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
