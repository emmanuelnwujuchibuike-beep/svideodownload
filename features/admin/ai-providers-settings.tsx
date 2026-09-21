"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AI_PROVIDERS_BOUNDS,
  AI_VENDOR_LABEL,
  MODEL_KEYS,
  PROVIDER_FEATURE_DEFS,
  type AiProvidersConfig,
  type AiVendor,
  type ModelKey,
  type ProviderFeature,
  type ProviderModelConfig,
  type SwitchableVendor,
} from "@/lib/ai/providers/config";
import type { ProviderComparisonRow, ProviderHealthRow } from "@/lib/ai/providers/runs";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI PROVIDERS — the switch, the models, the pauses, health, the comparison
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The fal.ai brief §10 ("FRENZ AI PROVIDERS — Character Replace [Replicate ▼]
 * · Lip Sync [Replicate ▼] · Text-to-Speech [ElevenLabs] LOCKED · Voice
 * Cloning [ElevenLabs] LOCKED · AI Clean: DO NOT DISPLAY"), §11 (the model
 * per feature/provider), §20 (the comparison — factual, no winner), §26
 * (health: connected / error, last success, last failure, the recent error,
 * the active provider — no secrets), §27 (Test Provider).
 *
 * Posts ONLY `frenzAiProviders` (deep-merged and clamped server-side; a route
 * or model change bumps the version every new job records). The two locked
 * rows have no control at all: the server ignores a provider for them even
 * if a request carried one. Lazy-loaded (features/admin/frenz-ai-settings-lazy.tsx)
 * so /admin's first load does not carry it.
 */
export interface AiProvidersPanelProps {
  config: AiProvidersConfig;
  /** Whether each vendor holds its credentials on this deployment (booleans only). */
  credentials: Record<AiVendor, boolean>;
  health: ProviderHealthRow[];
  comparison: ProviderComparisonRow[];
  /** The per-scope Replicate route today (model names), for the operator's eye. */
  replicateRoutes: { mode: string; model: string; routed: boolean; configured: boolean }[];
}

type ModelDraft = Record<keyof ProviderModelConfig, string | boolean>;

const toDraft = (m: ProviderModelConfig): ModelDraft => ({
  model: m.model,
  version: m.version,
  enabled: m.enabled,
  maxDurationSeconds: m.maxDurationSeconds === null ? "" : String(m.maxDurationSeconds),
  maxEdgePx: m.maxEdgePx === null ? "" : String(m.maxEdgePx),
  creditMultiplier: String(m.creditMultiplier),
  costUsdCentsPerSecond: String(m.costUsdCentsPerSecond),
  costUsdCentsPerRun: String(m.costUsdCentsPerRun),
  maxConcurrent: String(m.maxConcurrent),
  timeoutMinutes: String(m.timeoutMinutes),
  retryCount: String(m.retryCount),
  notes: m.notes,
});

const num = (raw: string | boolean, fallback: number) => {
  const n = Number(raw);
  return typeof raw !== "string" || raw.trim() === "" || !Number.isFinite(n) ? fallback : n;
};
const optNum = (raw: string | boolean) => (typeof raw !== "string" || raw.trim() === "" ? null : Number.isFinite(Number(raw)) ? Number(raw) : null);

const fromDraft = (d: ModelDraft): Partial<ProviderModelConfig> => ({
  model: String(d.model),
  version: String(d.version),
  enabled: d.enabled === true,
  maxDurationSeconds: optNum(d.maxDurationSeconds),
  maxEdgePx: optNum(d.maxEdgePx),
  creditMultiplier: num(d.creditMultiplier, 1),
  costUsdCentsPerSecond: num(d.costUsdCentsPerSecond, 0),
  costUsdCentsPerRun: num(d.costUsdCentsPerRun, 0),
  maxConcurrent: Math.round(num(d.maxConcurrent, 0)),
  timeoutMinutes: Math.round(num(d.timeoutMinutes, 0)),
  retryCount: Math.round(num(d.retryCount, 0)),
  notes: String(d.notes),
});

const ms = (v: number | null) => (v === null ? "—" : v < 1000 ? `${v} ms` : v < 60_000 ? `${(v / 1000).toFixed(1)} s` : `${(v / 60_000).toFixed(1)} min`);
const usd = (cents: number | null) => (cents === null ? "—" : `$${(cents / 100).toFixed(2)}`);
const when = (iso: string | null, now: number) => {
  if (!iso) return "never";
  const d = Math.max(0, now - Date.parse(iso));
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return `${Math.round(d / 86_400_000)} d ago`;
};

export function AiProvidersPanel({ config, credentials, health, comparison, replicateRoutes }: AiProvidersPanelProps) {
  const router = useRouter();
  const [crProvider, setCrProvider] = useState<SwitchableVendor>(config.features.character_replace.provider);
  const [unsupportedScopes, setUnsupportedScopes] = useState(config.features.character_replace.unsupportedScopes);
  const [falScopes, setFalScopes] = useState(config.features.character_replace.falScopes);
  const [lsProvider, setLsProvider] = useState<SwitchableVendor>(config.features.lip_sync.provider);
  const [paused, setPaused] = useState(config.paused);
  const [adminTests, setAdminTests] = useState(config.adminJobsAreTests);
  const [models, setModels] = useState<Record<ModelKey, ModelDraft>>(Object.fromEntries(MODEL_KEYS.map((k) => [k, toDraft(config.models[k])])) as Record<ModelKey, ModelDraft>);
  const [openModel, setOpenModel] = useState<ModelKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tests, setTests] = useState<Record<string, { busy: boolean; result: { ok: boolean; message: string; latencyMs: number; checks: { name: string; ok: boolean; detail: string }[] } | null }>>({});
  const now = Date.now();

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const payload = {
        features: {
          character_replace: { provider: crProvider, unsupportedScopes, falScopes: { upper_body: falScopes.upper_body, full_character: falScopes.full_character } },
          lip_sync: { provider: lsProvider },
        },
        models: Object.fromEntries(MODEL_KEYS.map((k) => [k, fromDraft(models[k])])),
        paused,
        adminJobsAreTests: adminTests,
      };
      const res = await fetch("/api/admin/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frenzAiProviders: payload }) });
      const json = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: "Saved. New jobs route by this; every job already running keeps the provider it started on." } : { ok: false, text: json.error ?? "Failed to save." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (feature: ProviderFeature, vendor: AiVendor) => {
    const key = `${feature}:${vendor}`;
    setTests((t) => ({ ...t, [key]: { busy: true, result: null } }));
    try {
      const res = await fetch("/api/admin/ai/providers/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature, vendor }) });
      const json = await res.json().catch(() => null);
      setTests((t) => ({ ...t, [key]: { busy: false, result: json && typeof json.ok === "boolean" ? json : { ok: false, message: json?.error ?? "The test did not answer.", latencyMs: 0, checks: [] } } }));
      router.refresh();
    } catch {
      setTests((t) => ({ ...t, [key]: { busy: false, result: { ok: false, message: "Network error.", latencyMs: 0, checks: [] } } }));
    }
  };

  const input = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const select = "mt-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const pill = (ok: boolean, text: string) => <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", ok ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-rose-500/12 text-rose-700 dark:text-rose-300")}>{text}</span>;

  return (
    <div className="space-y-6">
      {/* ── §10 the switch ─────────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Frenz AI providers</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          Which vendor runs each feature for NEW jobs. A job keeps the provider it started on, whatever changes here later; nothing is ever moved between providers and nothing falls
          back on its own. Text to Speech and Voice Replace are ElevenLabs by construction — not a setting.
        </p>
        <div className="space-y-4">
          {PROVIDER_FEATURE_DEFS.map((f) => {
            const current: AiVendor = f.locked ?? (f.id === "character_replace" ? crProvider : lsProvider);
            return (
              <div key={f.id} className="rounded-2xl border border-border/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{f.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{f.note}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {f.locked ? (
                      <span className="inline-flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-sm font-semibold">
                        {AI_VENDOR_LABEL[f.locked]}
                        <span className="rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-background">Locked</span>
                      </span>
                    ) : (
                      <label className="text-xs font-semibold text-muted-foreground">
                        Provider
                        <select value={current} onChange={(e) => (f.id === "character_replace" ? setCrProvider(e.target.value as SwitchableVendor) : setLsProvider(e.target.value as SwitchableVendor))} className={cn(select, "ml-2")}>
                          <option value="replicate">Replicate</option>
                          <option value="fal">fal.ai</option>
                        </select>
                      </label>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  {f.vendors.map((v) => (
                    <span key={v} className={cn("rounded-full border px-2 py-0.5", v === current ? "border-foreground font-semibold" : "border-border/70 text-muted-foreground")}>
                      {AI_VENDOR_LABEL[v]} · {f.models[v]} {credentials[v] ? "" : "· no key"}
                    </span>
                  ))}
                </div>
                {f.id === "character_replace" ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-semibold text-muted-foreground">
                      Scopes the fal.ai model cannot serve
                      <select value={unsupportedScopes} onChange={(e) => setUnsupportedScopes(e.target.value as "unavailable" | "replicate")} className={cn(select, "mt-1 w-full")}>
                        <option value="unavailable">Unavailable while fal.ai is active (default)</option>
                        <option value="replicate">Keep those scopes on Replicate</option>
                      </select>
                      <span className="mt-1 block font-normal leading-relaxed text-muted-foreground/80">Kling O1 Video Edit claims Full Character and Upper Body. Face Only and Face + Head are face-swap tasks it does not claim — never re-mapped in silence.</span>
                    </label>
                    <div className="text-xs font-semibold text-muted-foreground">
                      Scopes fal.ai may serve
                      <div className="mt-2 space-y-1.5">
                        {(["full_character", "upper_body"] as const).map((scope) => (
                          <label key={scope} className="flex items-center gap-2 font-normal">
                            <input type="checkbox" checked={falScopes[scope]} onChange={(e) => setFalScopes((s) => ({ ...s, [scope]: e.target.checked }))} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                            {scope === "full_character" ? "Full Character" : "Upper Body"}
                          </label>
                        ))}
                        <p className="font-normal text-muted-foreground/80">Face Only · Face + Head: not in the capability mapping.</p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* ── §26 emergency controls ─────────────────────────────────────── */}
        <div className="mt-6 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
          <p className="text-sm font-semibold">Emergency controls</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">A paused vendor accepts no new runs — members read &ldquo;temporarily unavailable, nothing charged&rdquo;. Jobs already at that vendor finish. Nothing is moved elsewhere.</p>
          <div className="mt-3 flex flex-wrap gap-4">
            {(["replicate", "fal"] as const).map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={paused[v]} onChange={(e) => setPaused((p) => ({ ...p, [v]: e.target.checked }))} className="h-4 w-4 accent-[hsl(var(--primary))]" />
                Pause {AI_VENDOR_LABEL[v]}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={adminTests} onChange={(e) => setAdminTests(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--primary))]" />
              Jobs an admin creates are TEST runs
            </label>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={submit} disabled={busy} className="rounded-xl bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50">
            {busy ? "Saving…" : "Save providers"}
          </button>
          {msg ? <p className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-600")}>{msg.text}</p> : null}
          <p className="text-xs text-muted-foreground">Version {config.version}{config.updatedAt ? ` · changed ${when(config.updatedAt, now)}` : ""}</p>
        </div>
      </section>

      {/* ── §11 the models ─────────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Models</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          One configuration per feature and provider: the endpoint, a version pin where the vendor has one, ceilings, the credit multiplier (1 = credits are the same whoever runs it), the
          cost profile the estimate uses, concurrency, timeout, retries. The Replicate side&apos;s model is chosen per scope / per tier on the Character Replace pricing tab — shown here, edited
          there.
        </p>
        <div className="space-y-2">
          {MODEL_KEYS.map((key) => {
            const [feature, vendor] = key.split(":") as [ProviderFeature, SwitchableVendor];
            const d = models[key];
            const open = openModel === key;
            const set = (patch: Partial<ModelDraft>) => setModels((m) => ({ ...m, [key]: { ...m[key], ...patch } }));
            const t = tests[`${feature}:${vendor}`];
            return (
              <div key={key} className="rounded-2xl border border-border/70">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <button type="button" onClick={() => setOpenModel(open ? null : key)} className="min-w-0 text-left">
                    <p className="text-sm font-semibold">
                      {feature === "character_replace" ? "Character Replace" : "Lip Sync"} · {AI_VENDOR_LABEL[vendor]}
                      {!d.enabled ? <span className="ml-2 rounded-full bg-rose-500/12 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700 dark:text-rose-300">disabled</span> : null}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{String(d.model)}</p>
                  </button>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => runTest(feature, vendor)} disabled={t?.busy} className="rounded-xl border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                      {t?.busy ? "Testing…" : "Test provider"}
                    </button>
                    <button type="button" onClick={() => setOpenModel(open ? null : key)} className="rounded-xl border border-border px-3 py-1.5 text-xs font-semibold">
                      {open ? "Close" : "Configure"}
                    </button>
                  </div>
                </div>
                {t?.result ? (
                  <div className={cn("mx-4 mb-3 rounded-xl px-3 py-2 text-xs", t.result.ok ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : "bg-rose-500/10 text-rose-800 dark:text-rose-200")}>
                    <p className="font-semibold">{t.result.message}</p>
                    {t.result.checks.length ? (
                      <ul className="mt-1 space-y-0.5">
                        {t.result.checks.map((c) => (
                          <li key={c.name}>{c.ok ? "✓" : "✗"} {c.name} — {c.detail}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {open ? (
                  <div className="grid gap-3 border-t border-border/70 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="block sm:col-span-2 lg:col-span-3">
                      <span className="text-xs font-semibold text-muted-foreground">Model / endpoint</span>
                      <input value={String(d.model)} onChange={(e) => set({ model: e.target.value })} className={input} disabled={vendor === "replicate"} />
                      {vendor === "fal" && feature === "character_replace" ? <span className="mt-1 block text-[11px] text-muted-foreground/80">Kling O1 Video Edit. A Wan endpoint is refused here — the comparison is against a different model family.</span> : null}
                    </label>
                    <Field label="Version pin"><input value={String(d.version)} onChange={(e) => set({ version: e.target.value })} className={input} placeholder={vendor === "fal" ? "none (fal endpoints are unversioned)" : "adapter's own pin"} /></Field>
                    <Field label="Enabled">
                      <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={d.enabled === true} onChange={(e) => set({ enabled: e.target.checked })} className="h-4 w-4 accent-[hsl(var(--primary))]" /> route jobs here</label>
                    </Field>
                    <Field label="Max duration (s)" hint={`Blank = the model's own. ${AI_PROVIDERS_BOUNDS.maxDurationSeconds.min}–${AI_PROVIDERS_BOUNDS.maxDurationSeconds.max}.`}><input inputMode="numeric" value={String(d.maxDurationSeconds)} onChange={(e) => set({ maxDurationSeconds: e.target.value })} className={input} /></Field>
                    <Field label="Max edge (px)" hint="Blank = the model's own."><input inputMode="numeric" value={String(d.maxEdgePx)} onChange={(e) => set({ maxEdgePx: e.target.value })} className={input} /></Field>
                    <Field label="Credit multiplier" hint="1 = provider-independent credits."><input inputMode="decimal" value={String(d.creditMultiplier)} onChange={(e) => set({ creditMultiplier: e.target.value })} className={input} /></Field>
                    <Field label="Cost per second (US ¢)" hint="Estimate basis. 0 = unknown."><input inputMode="decimal" value={String(d.costUsdCentsPerSecond)} onChange={(e) => set({ costUsdCentsPerSecond: e.target.value })} className={input} /></Field>
                    <Field label="Cost per run (US ¢)"><input inputMode="decimal" value={String(d.costUsdCentsPerRun)} onChange={(e) => set({ costUsdCentsPerRun: e.target.value })} className={input} /></Field>
                    <Field label="Max concurrent" hint="0 = only the member/global caps."><input inputMode="numeric" value={String(d.maxConcurrent)} onChange={(e) => set({ maxConcurrent: e.target.value })} className={input} /></Field>
                    <Field label="Timeout (min)" hint="0 = the processing default."><input inputMode="numeric" value={String(d.timeoutMinutes)} onChange={(e) => set({ timeoutMinutes: e.target.value })} className={input} /></Field>
                    <Field label="Retries"><input inputMode="numeric" value={String(d.retryCount)} onChange={(e) => set({ retryCount: e.target.value })} className={input} /></Field>
                    <label className="block sm:col-span-2 lg:col-span-3">
                      <span className="text-xs font-semibold text-muted-foreground">Notes</span>
                      <textarea value={String(d.notes)} onChange={(e) => set({ notes: e.target.value })} className={cn(input, "min-h-[4rem]")} maxLength={400} />
                    </label>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="mt-4 text-xs text-muted-foreground">
          <p className="font-semibold">Replicate routes today (per scope)</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {replicateRoutes.map((r) => (
              <li key={r.mode} className="rounded-full border border-border/70 px-2 py-0.5">
                {r.mode} → {r.model} {r.routed ? "" : "· no adapter"} {r.configured ? "" : "· not configured"}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(["text_to_speech", "voice_change"] as const).map((f) => {
            const t = tests[`${f}:elevenlabs`];
            return (
              <div key={f} className="flex flex-col gap-1">
                <button type="button" onClick={() => runTest(f, "elevenlabs")} disabled={t?.busy} className="rounded-xl border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
                  {t?.busy ? "Testing…" : `Test ElevenLabs (${f === "text_to_speech" ? "Text to Speech" : "Voice Replace"})`}
                </button>
                {t?.result ? <p className={cn("max-w-xs text-[11px]", t.result.ok ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>{t.result.message}</p> : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── §26 health ─────────────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Provider health</h2>
        <p className="mb-4 text-sm text-muted-foreground">Credential presence (never the values), the last success and failure from the run ledger, the most recent error. &ldquo;Active&rdquo; = chosen for new jobs of that feature.</p>
        <div className="grid gap-3 md:grid-cols-3">
          {health.map((h) => {
            const activeFor = PROVIDER_FEATURE_DEFS.filter((f) => (f.locked ?? (f.id === "character_replace" ? config.features.character_replace.provider : f.id === "lip_sync" ? config.features.lip_sync.provider : null)) === h.provider).map((f) => f.label);
            const errored = h.failures24h > 0 && (!h.lastSuccessAt || (h.lastFailureAt && Date.parse(h.lastFailureAt) > Date.parse(h.lastSuccessAt)));
            return (
              <div key={h.provider} className="rounded-2xl border border-border/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{AI_VENDOR_LABEL[h.provider]}</p>
                  {pill(h.credentials && !errored, !h.credentials ? "No key" : errored ? "Error" : "Connected")}
                </div>
                <dl className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between gap-2"><dt>Active for</dt><dd className="text-right font-medium text-foreground">{activeFor.length ? activeFor.join(", ") : "—"}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Last success</dt><dd className="font-medium text-foreground">{when(h.lastSuccessAt, now)}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Last failure</dt><dd className="font-medium text-foreground">{when(h.lastFailureAt, now)}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Runs / failures (24 h)</dt><dd className="font-medium text-foreground">{h.runs24h} / {h.failures24h}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Submit latency</dt><dd className="font-medium text-foreground">{ms(h.avgSubmitLatencyMs)}</dd></div>
                  {(h.provider === "replicate" || h.provider === "fal") && config.paused[h.provider] ? <div className="text-amber-600">Paused by the operator.</div> : null}
                </dl>
                {h.recentError ? <p className="mt-2 rounded-lg bg-rose-500/[0.08] px-2 py-1 text-[11px] text-rose-700 dark:text-rose-300">{h.recentError.code ?? "error"} · {h.recentError.model} · {h.recentError.detail ?? ""}</p> : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── §20 the comparison ─────────────────────────────────────────────── */}
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Provider comparison</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Factual metrics per feature, provider and model from the run ledger (last 30 days; admin test runs counted apart). Costs are the operator&apos;s ESTIMATES unless a vendor reported an
          actual figure. No score — compare the numbers and the outputs.
        </p>
        {comparison.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">No provider run has been recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Feature</th>
                  <th className="py-2 pr-3">Provider · model</th>
                  <th className="py-2 pr-3 text-right">Jobs</th>
                  <th className="py-2 pr-3 text-right">Success</th>
                  <th className="py-2 pr-3 text-right">Failed</th>
                  <th className="py-2 pr-3 text-right">Rate</th>
                  <th className="py-2 pr-3 text-right">Avg queue</th>
                  <th className="py-2 pr-3 text-right">Avg processing</th>
                  <th className="py-2 pr-3 text-right">Avg total</th>
                  <th className="py-2 pr-3 text-right">Est. cost</th>
                  <th className="py-2 pr-3 text-right">Actual cost</th>
                  <th className="py-2 pr-3">Failures</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {comparison.map((r) => (
                  <tr key={`${r.feature}|${r.provider}|${r.model}`}>
                    <td className="py-2 pr-3 font-medium">{r.feature.replace(/^ai_/, "").replace(/_/g, " ")}</td>
                    <td className="py-2 pr-3"><span className="font-semibold">{AI_VENDOR_LABEL[r.provider]}</span> <span className="text-muted-foreground">· {r.model}</span>{r.testRuns ? <span className="ml-1 text-muted-foreground">· {r.testRuns} test</span> : null}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.jobs}{r.inFlight ? <span className="text-muted-foreground"> (+{r.inFlight} running)</span> : null}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.succeeded}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.failed}{r.cancelled ? <span className="text-muted-foreground"> · {r.cancelled} cancelled</span> : null}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.successRate === null ? "—" : `${r.successRate}%`}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{ms(r.avgQueueMs)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{ms(r.avgProcessingMs)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{ms(r.avgTotalMs)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{usd(r.estimatedCostUsdCents)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.actualCostUsdCents === null ? "— (estimate only)" : `${usd(r.actualCostUsdCents)} (${r.actualCostRuns})`}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{r.failures.length ? r.failures.map((f) => `${f.code} ×${f.count}`).join(", ") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
