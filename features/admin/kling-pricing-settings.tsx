"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { KlingConnectionCard } from "@/features/admin/kling-connection-card";
import {
  klingQuoteMarginUsdCents,
  klingTierCostKnown,
  quoteKling,
  KLING_PRICED_FEATURE_LABEL,
  KLING_TIER_KEYS,
  type KlingPricingConfig,
  type KlingTierKey,
  type KlingTierPricing,
} from "@/lib/ai/kling/pricing";
import type { LandingSettings } from "@/lib/landing/settings";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI → KLING PRICING — the matrix, the margin, and the emergency pause
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 4 §14: "The admin dashboard must have a proper Kling pricing
 * configuration section. Admin should be able to configure the FrenzSave customer
 * pricing without editing source code… Keep provider consumption data separate
 * from customer pricing. Do not expose internal provider credentials."
 *
 * ── 🔴 TWO COLUMNS THAT ARE NEVER THE SAME NUMBER ───────────────────────────
 *
 * Kling charges in UNITS, reported per task. What a member pays is a separate
 * decision in US cents. The panel keeps them visually apart for the same reason
 * the config keeps them in separate fields: an operator correcting what Kling
 * charges us must never accidentally re-price a member.
 *
 * ── 🔴 "NOT MEASURED" IS SHOWN AS "NOT MEASURED" ────────────────────────────
 *
 * 720p was measured against the live API (0.6 units/second, twice). 1080p and 4K
 * were not. Their cost is 0 in the config meaning UNKNOWN, and this panel prints
 * "not measured" and hides the margin rather than showing a confident-looking
 * figure nobody checked. This project has a standing rule against displaying a
 * fabricated statistic, and an invented margin is exactly that.
 *
 * Posts ONLY `frenzAiKlingPricing`. No credential is read, shown or posted here.
 */

const num = (raw: string, fallback: number) => {
  const n = Number(raw);
  return raw.trim() === "" || !Number.isFinite(n) ? fallback : n;
};
const int = (raw: string, fallback: number) => {
  const n = Math.floor(Number(raw));
  return raw.trim() === "" || !Number.isFinite(n) ? fallback : n;
};

/** The label for a tier row, from the key rather than a second hand-written list. */
function tierLabel(key: KlingTierKey): { feature: string; tier: string } {
  const [feature, tier] = key.split(":") as [keyof typeof KLING_PRICED_FEATURE_LABEL, string];
  return { feature: KLING_PRICED_FEATURE_LABEL[feature] ?? feature, tier: tier === "source" ? "source resolution" : tier };
}

type Draft = Record<KlingTierKey, {
  enabled: boolean;
  providerUnitsPerSecond: string;
  providerUnitsPerRun: string;
  unitCostUsdCents: string;
  priceUsdCentsPerSecond: string;
  priceUsdCentsPerRun: string;
  audioSurchargeUsdCentsPerSecond: string;
  referenceVideoSurchargeUsdCentsPerRun: string;
  referenceImageSurchargeUsdCentsPerRun: string;
  minBillableSeconds: string;
  minSeconds: string;
  maxSeconds: string;
  notes: string;
}>;

const toDraft = (m: Record<KlingTierKey, KlingTierPricing>): Draft =>
  Object.fromEntries(
    KLING_TIER_KEYS.map((k) => [
      k,
      {
        enabled: m[k].enabled,
        providerUnitsPerSecond: String(m[k].providerUnitsPerSecond),
        providerUnitsPerRun: String(m[k].providerUnitsPerRun),
        unitCostUsdCents: String(m[k].unitCostUsdCents),
        priceUsdCentsPerSecond: String(m[k].priceUsdCentsPerSecond),
        priceUsdCentsPerRun: String(m[k].priceUsdCentsPerRun),
        audioSurchargeUsdCentsPerSecond: String(m[k].audioSurchargeUsdCentsPerSecond),
        referenceVideoSurchargeUsdCentsPerRun: String(m[k].referenceVideoSurchargeUsdCentsPerRun),
        referenceImageSurchargeUsdCentsPerRun: String(m[k].referenceImageSurchargeUsdCentsPerRun),
        minBillableSeconds: String(m[k].minBillableSeconds),
        minSeconds: String(m[k].minSeconds),
        maxSeconds: String(m[k].maxSeconds),
        notes: m[k].notes,
      },
    ]),
  ) as Draft;

export function KlingPricingSettingsPanel({ settings }: { settings: LandingSettings }) {
  const router = useRouter();
  const cfg: KlingPricingConfig = settings.frenzAiKlingPricing;
  const [draft, setDraft] = useState<Draft>(() => toDraft(cfg.matrix));
  const [paused, setPaused] = useState(cfg.paused);
  // One minute (owner, 2026-10-06): its own switch and price, sent with every save so a save never resets it.
  const [oneMinuteOn, setOneMinuteOn] = useState(cfg.oneMinute.enabled);
  const [oneMinute720, setOneMinute720] = useState(String(cfg.oneMinute.priceUsdCents["720p"]));
  const [oneMinute1080, setOneMinute1080] = useState(String(cfg.oneMinute.priceUsdCents["1080p"]));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (key: KlingTierKey, patch: Partial<Draft[KlingTierKey]>) => setDraft((all) => ({ ...all, [key]: { ...all[key], ...patch } }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const matrix = Object.fromEntries(
        KLING_TIER_KEYS.map((k) => {
          const d = draft[k];
          const base = cfg.matrix[k];
          return [
            k,
            {
              enabled: d.enabled,
              providerUnitsPerSecond: num(d.providerUnitsPerSecond, base.providerUnitsPerSecond),
              providerUnitsPerRun: num(d.providerUnitsPerRun, base.providerUnitsPerRun),
              unitCostUsdCents: num(d.unitCostUsdCents, base.unitCostUsdCents),
              priceUsdCentsPerSecond: num(d.priceUsdCentsPerSecond, base.priceUsdCentsPerSecond),
              priceUsdCentsPerRun: num(d.priceUsdCentsPerRun, base.priceUsdCentsPerRun),
              audioSurchargeUsdCentsPerSecond: num(d.audioSurchargeUsdCentsPerSecond, base.audioSurchargeUsdCentsPerSecond),
              referenceVideoSurchargeUsdCentsPerRun: num(d.referenceVideoSurchargeUsdCentsPerRun, base.referenceVideoSurchargeUsdCentsPerRun),
              referenceImageSurchargeUsdCentsPerRun: num(d.referenceImageSurchargeUsdCentsPerRun, base.referenceImageSurchargeUsdCentsPerRun),
              minBillableSeconds: int(d.minBillableSeconds, base.minBillableSeconds),
              minSeconds: int(d.minSeconds, base.minSeconds),
              maxSeconds: int(d.maxSeconds, base.maxSeconds),
              notes: d.notes,
            },
          ];
        }),
      );
      const res = await fetch("/api/admin/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          frenzAiKlingPricing: {
            matrix,
            paused,
            oneMinute: { enabled: oneMinuteOn, priceUsdCents: { "720p": num(oneMinute720, 0), "1080p": num(oneMinute1080, 0) } },
          },
        }) });
      const json = await res.json().catch(() => ({}));
      setMsg(res.ok ? { ok: true, text: "Saved. New quotes use this; a job already quoted keeps the price it was quoted at." } : { ok: false, text: json.error ?? "Failed to save." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const input = "mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

  return (
    <div className="space-y-6">
      <KlingConnectionCard />
      <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
        <h2 className="mb-1 font-semibold">Kling pricing</h2>
        <p className="mb-5 text-sm text-muted-foreground">
          Kling charges in <strong>units</strong>, reported on every finished task. What a member pays is a separate decision, in US cents. Both live on each row below and are never the same number — changing what Kling costs us
          does not re-price anybody.
        </p>

        <label className="flex items-start gap-3 rounded-2xl border border-border/70 p-4">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} className="mt-1 size-4" />
          <span>
            <span className="block text-sm font-semibold">Pause Kling generation</span>
            <span className="block text-[11px] text-muted-foreground">
              An emergency control. New generations are refused with a sentence; jobs already running finish normally, and nothing is moved to another provider.
            </span>
          </span>
        </label>

        <div className="mt-4 rounded-2xl border border-border/70 p-4">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={oneMinuteOn} onChange={(e) => setOneMinuteOn(e.target.checked)} className="mt-1 size-4" />
            <span>
              <span className="block text-sm font-semibold">One-minute videos (60 s)</span>
              <span className="block text-[11px] text-muted-foreground">
                Made as four 15 s segments, each starting on the last frame of the one before, joined into one video. Text to Video and Image to Video, at 720p or 1080p.
                Kling bills four segments: about {Math.round(60 * (cfg.matrix["text_to_video:720p"].providerUnitsPerSecond || 0.6) * 10) / 10} units at 720p.
                A one-minute video cannot use a reference video.
              </span>
            </span>
          </label>
          <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
            {(
              [
                ["720p", oneMinute720, setOneMinute720, "text_to_video:720p"],
                ["1080p", oneMinute1080, setOneMinute1080, "text_to_video:1080p"],
              ] as const
            ).map(([res, value, setValue, tierKey]) => (
              <label key={res} className="text-xs font-medium">
                Price at {res} (US cents)
                <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className={input} />
                <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                  {num(value, 0) > 0
                    ? `Members pay ${usd(num(value, 0))}.`
                    : `0 = 60 × the per-second price: ${usd(Math.ceil(60 * cfg.matrix[tierKey].priceUsdCentsPerSecond))}.`}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {KLING_TIER_KEYS.map((key) => {
            const d = draft[key];
            const { feature, tier } = tierLabel(key);
            const measured = klingTierCostKnown({ ...cfg.matrix[key], providerUnitsPerSecond: num(d.providerUnitsPerSecond, 0), providerUnitsPerRun: num(d.providerUnitsPerRun, 0) });
            /* A worked example at the tier's own floor, priced by the SAME function the server uses. */
            const sample = quoteKling(
              {
                ...cfg,
                paused: false,
                matrix: {
                  ...cfg.matrix,
                  [key]: {
                    ...cfg.matrix[key],
                    enabled: true,
                    providerUnitsPerSecond: num(d.providerUnitsPerSecond, 0),
                    providerUnitsPerRun: num(d.providerUnitsPerRun, 0),
                    unitCostUsdCents: num(d.unitCostUsdCents, 0),
                    priceUsdCentsPerSecond: num(d.priceUsdCentsPerSecond, 0),
                    priceUsdCentsPerRun: num(d.priceUsdCentsPerRun, 0),
                    minBillableSeconds: int(d.minBillableSeconds, 3),
                    minSeconds: int(d.minSeconds, 3),
                    maxSeconds: int(d.maxSeconds, 15),
                  },
                },
              },
              {
                feature: key.startsWith("text_to_video") ? "text_to_video" : key.startsWith("image_to_video") ? "image_to_video" : "lip_sync",
                resolution: key.endsWith("1080p") ? "1080p" : key.endsWith("4k") ? "4k" : "720p",
                seconds: int(d.minBillableSeconds, 3),
              },
            );
            const margin = klingQuoteMarginUsdCents(sample);

            return (
              <div key={key} className={cn("rounded-2xl border p-4", d.enabled ? "border-border/70" : "border-border/40 opacity-70")}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      {feature} <span className="text-muted-foreground">· {tier}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">{d.notes || "—"}</p>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input type="checkbox" checked={d.enabled} onChange={(e) => set(key, { enabled: e.target.checked })} className="size-4" />
                    On sale
                  </label>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {/* ── cost: what KLING charges US ─────────────────────────── */}
                  <div className="rounded-xl border border-border/60 bg-secondary/20 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">What Kling charges us</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <label className="block text-[11px] font-semibold text-muted-foreground">
                        Units / second
                        <input value={d.providerUnitsPerSecond} onChange={(e) => set(key, { providerUnitsPerSecond: e.target.value })} inputMode="decimal" className={input} />
                      </label>
                      <label className="block text-[11px] font-semibold text-muted-foreground">
                        Units / run
                        <input value={d.providerUnitsPerRun} onChange={(e) => set(key, { providerUnitsPerRun: e.target.value })} inputMode="decimal" className={input} />
                      </label>
                      <label className="block text-[11px] font-semibold text-muted-foreground">
                        ¢ per unit
                        <input value={d.unitCostUsdCents} onChange={(e) => set(key, { unitCostUsdCents: e.target.value })} inputMode="decimal" className={input} />
                      </label>
                    </div>
                    {!measured && (
                      /* 🔴 Never a guessed number. See the file header. */
                      <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
                        Provider cost <strong>not measured</strong> for this tier. Run one generation at this setting and read <code>billing.amount</code> off the task before trusting any margin.
                      </p>
                    )}
                  </div>

                  {/* ── revenue: what the MEMBER pays ───────────────────────── */}
                  <div className="rounded-xl border border-border/60 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">What the member pays</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <label className="block text-[11px] font-semibold text-muted-foreground">
                        ¢ / second
                        <input value={d.priceUsdCentsPerSecond} onChange={(e) => set(key, { priceUsdCentsPerSecond: e.target.value })} inputMode="decimal" className={input} />
                      </label>
                      <label className="block text-[11px] font-semibold text-muted-foreground">
                        ¢ / run
                        <input value={d.priceUsdCentsPerRun} onChange={(e) => set(key, { priceUsdCentsPerRun: e.target.value })} inputMode="decimal" className={input} />
                      </label>
                      <label className="block text-[11px] font-semibold text-muted-foreground">
                        ¢ / s with sound
                        <input
                          value={d.audioSurchargeUsdCentsPerSecond}
                          onChange={(e) => set(key, { audioSurchargeUsdCentsPerSecond: e.target.value })}
                          inputMode="decimal"
                          disabled={key.startsWith("lip_sync")}
                          className={cn(input, key.startsWith("lip_sync") && "opacity-50")}
                        />
                      </label>
                      {/*
                        The reference surcharges. Disabled on Lip Sync for the
                        same reason the sound one is: its video and audio are the
                        feature's REQUIRED inputs, not optional references, so a
                        surcharge there would charge for the tool itself. The
                        quote refuses to apply them to Lip Sync regardless — this
                        only stops an operator typing a number that does nothing.
                      */}
                      <label className="block text-[11px] font-semibold text-muted-foreground">
                        ¢ / reference image
                        <input
                          value={d.referenceImageSurchargeUsdCentsPerRun}
                          onChange={(e) => set(key, { referenceImageSurchargeUsdCentsPerRun: e.target.value })}
                          inputMode="decimal"
                          disabled={key.startsWith("lip_sync")}
                          className={cn(input, key.startsWith("lip_sync") && "opacity-50")}
                        />
                      </label>
                      <label className="block text-[11px] font-semibold text-muted-foreground">
                        ¢ / reference video
                        <input
                          value={d.referenceVideoSurchargeUsdCentsPerRun}
                          onChange={(e) => set(key, { referenceVideoSurchargeUsdCentsPerRun: e.target.value })}
                          inputMode="decimal"
                          disabled={key.startsWith("lip_sync")}
                          className={cn(input, key.startsWith("lip_sync") && "opacity-50")}
                        />
                      </label>
                    </div>
                    <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                      Reference surcharges are charged <strong>per run</strong> — once for a reference video, and once for each reference image. Both start at 0, so
                      until you set them a referenced generation costs the same as a plain one. Kling allows 7 reference images, or 4 alongside a reference video.
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <label className="block text-[11px] font-semibold text-muted-foreground">
                    Shortest
                    <input value={d.minSeconds} onChange={(e) => set(key, { minSeconds: e.target.value })} inputMode="numeric" className={input} />
                  </label>
                  <label className="block text-[11px] font-semibold text-muted-foreground">
                    Longest
                    <input value={d.maxSeconds} onChange={(e) => set(key, { maxSeconds: e.target.value })} inputMode="numeric" className={input} />
                  </label>
                  <label className="block text-[11px] font-semibold text-muted-foreground">
                    Minimum billed
                    <input value={d.minBillableSeconds} onChange={(e) => set(key, { minBillableSeconds: e.target.value })} inputMode="numeric" className={input} />
                  </label>
                  <div className="rounded-xl border border-border/60 px-3 py-2 text-[11px]">
                    <span className="block font-semibold text-muted-foreground">At {d.minBillableSeconds || "?"}s</span>
                    <span className="block tabular-nums">
                      {sample.ok ? usd(sample.totalUsdCents) : "—"}
                      {margin !== null ? <span className="text-muted-foreground"> · margin {usd(margin)}</span> : <span className="text-muted-foreground"> · margin unknown</span>}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={busy} className="rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-60">
            {busy ? "Saving…" : "Save Kling pricing"}
          </button>
          {msg && <span className={cn("text-sm", msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500")}>{msg.text}</span>}
        </div>
      </section>
    </div>
  );
}
