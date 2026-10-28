"use client";

import { useEffect, useMemo, useState } from "react";

import { type FgcConversionRules, roundTripExample, roundTripPercent } from "@/lib/gift/conversion-rules";
import type { FrenzGiftSettings } from "@/lib/gift/settings";

import { postMoney, useAdminRead } from "../frenz-coin/coin-admin-data";
import { Badge, BTN, Card, Field, INPUT, Message, usd, when } from "../frenz-coin/coin-admin-ui";
import { formFromRules, type GiftConversionForm, isDirty, type LegForm, type LegName, rateText, readForm } from "./gift-admin-logic";

type SensitiveFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type Read = { settings: FrenzGiftSettings; summary: { roundTripPercent: string } | null };

const fgc = (minor: number) => `${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} FGC`;

const LEGS: { name: LegName; title: string; inLabel: string; outLabel: string; amount: (m: number) => string; out: (m: number) => string }[] = [
  { name: "fcToFgc", title: "Frenz Coin → Gift Coin", inLabel: "FC ($)", outLabel: "FGC", amount: usd, out: fgc },
  { name: "fgcToFc", title: "Gift Coin → Frenz Coin", inLabel: "FGC", outLabel: "FC ($)", amount: fgc, out: usd },
];

/**
 * Admin → Frenz Coin → Gift Coin (Frenz Gift Coin Part 3). The two conversion legs: rate, percentage and flat fee (both
 * deducted from what the conversion PRODUCES, in that currency), and the per-conversion and daily limits. Read from and
 * saved to /api/admin/gift/settings (a fresh password, checked again by the server and the database, audited). Every
 * box is empty until an administrator fills it: nothing here is a default. The round-trip figure is roundTripFactor's
 * bound (the most a round trip can keep) with one real round trip beside it, computed with the engine's own rounding.
 */
export function GiftSettings({ sensitiveFetch }: { sensitiveFetch: SensitiveFetch }) {
  const read = useAdminRead<Read>("/api/admin/gift/settings");
  const stored = read.data?.settings.conversion ?? null;
  const [form, setForm] = useState<GiftConversionForm>(() => formFromRules(null));
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // the stored rules become the form once per loaded version (a save or a refresh brings the new one)
  useEffect(() => {
    if (!read.data) return;
    const v = read.data.settings.conversion?.version ?? 0;
    if (loadedVersion !== v) {
      setForm(formFromRules(read.data.settings.conversion));
      setLoadedVersion(v);
    }
  }, [read.data, loadedVersion]);

  const version = stored?.version ?? 0;
  const result = useMemo(() => readForm(form, version), [form, version]);
  const dirty = isDirty(form, stored);

  // unsaved-change protection: leaving the page with edits asks first
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (leg: LegName, k: keyof LegForm, v: string) => {
    setMsg(null);
    setForm((f) => ({ ...f, [leg]: { ...f[leg], [k]: v } }));
  };

  const save = async () => {
    if (!result.ok || !dirty || busy) return;
    setBusy(true);
    setMsg(null);
    const r = await postMoney<{ unchanged: boolean; version: number; conversion: FgcConversionRules }>(sensitiveFetch, "/api/admin/gift/settings", { ...result.legs, expectedVersion: version });
    setBusy(false);
    if (!r.ok) {
      if (r.reason === "stale") await read.reload();
      return setMsg({ kind: "error", text: r.error });
    }
    // only the server's confirmed, read-back value counts as saved
    await read.reload();
    setMsg({ kind: "ok", text: r.data.unchanged ? "Nothing changed — the stored rules are the same." : `Saved as version ${r.data.version}. Recorded in the audit log.` });
  };

  if (read.loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (read.error && !read.data) return <Message kind="error">{read.error}</Message>;

  const live = result.ok ? result.rules : null;
  const pct = live ? roundTripPercent(live) : null;
  const example = live ? roundTripExample(live) : null;
  const errs = result.ok ? {} : result.fields;

  return (
    <div className="space-y-5">
      <Card
        title="Gift Coin conversion"
        action={
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {stored ? <Badge tone="green">Configured · version {stored.version}</Badge> : <Badge tone="amber">Not configured</Badge>}
            {read.data?.settings.updatedAt ? `changed ${when(read.data.settings.updatedAt)}` : null}
          </span>
        }
      >
        {!stored ? (
          <Message kind="info">No conversion rules are saved yet, so members can&apos;t convert. Fill in both directions and save — nothing has a default.</Message>
        ) : null}
        {read.data?.settings.problem ? <div className="mt-2"><Message kind="error">The stored rules can&apos;t be used, so conversions are refused: {read.data.settings.problem}</Message></div> : null}
        <p className="mt-3 text-xs text-muted-foreground">
          Amounts are in each currency&apos;s units (1 FC = $1, 2 decimals; 1 FGC, 2 decimals). The rate is a fraction so it is exact. Each fee — the percentage (rounded up) and the flat fee — is taken from what the conversion
          produces, in that currency. The output is rounded down.
        </p>
      </Card>

      {LEGS.map((l) => {
        const f = form[l.name];
        const e = (k: keyof LegForm) => errs[`${l.name}.${k}`];
        const num = Number(f.rateNum);
        const den = Number(f.rateDen);
        return (
          <Card key={l.name} title={l.title}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field htmlFor={`g-${l.name}-num`} label="Rate: output units" hint={`1 ${l.inLabel.replace(" ($)", "")} → ${rateText(num, den)} ${l.outLabel.replace(" ($)", "")} before fees`} error={e("rateNum")}>
                <input id={`g-${l.name}-num`} inputMode="numeric" className={INPUT} value={f.rateNum} onChange={(ev) => set(l.name, "rateNum", ev.target.value)} />
              </Field>
              <Field htmlFor={`g-${l.name}-den`} label="Rate: per input units" hint="Whole numbers, 1 to 999,999,999" error={e("rateDen")}>
                <input id={`g-${l.name}-den`} inputMode="numeric" className={INPUT} value={f.rateDen} onChange={(ev) => set(l.name, "rateDen", ev.target.value)} />
              </Field>
              <Field htmlFor={`g-${l.name}-pct`} label={`Fee (%) — from the ${l.outLabel}`} hint="0 to 50, up to 2 decimals" error={e("feePercent")}>
                <input id={`g-${l.name}-pct`} inputMode="decimal" className={INPUT} value={f.feePercent} onChange={(ev) => set(l.name, "feePercent", ev.target.value)} />
              </Field>
              <Field htmlFor={`g-${l.name}-flat`} label={`Flat fee (${l.outLabel}) — from the ${l.outLabel}`} hint="0 for none" error={e("feeFlat")}>
                <input id={`g-${l.name}-flat`} inputMode="decimal" className={INPUT} value={f.feeFlat} onChange={(ev) => set(l.name, "feeFlat", ev.target.value)} />
              </Field>
              <Field htmlFor={`g-${l.name}-min`} label={`Smallest conversion (${l.inLabel})`} error={e("min")}>
                <input id={`g-${l.name}-min`} inputMode="decimal" className={INPUT} value={f.min} onChange={(ev) => set(l.name, "min", ev.target.value)} />
              </Field>
              <Field htmlFor={`g-${l.name}-max`} label={`Largest conversion (${l.inLabel})`} error={e("max")}>
                <input id={`g-${l.name}-max`} inputMode="decimal" className={INPUT} value={f.max} onChange={(ev) => set(l.name, "max", ev.target.value)} />
              </Field>
              <Field htmlFor={`g-${l.name}-day`} label={`Daily limit per member (${l.inLabel})`} hint="Rolling 24 hours, this direction" error={e("daily")}>
                <input id={`g-${l.name}-day`} inputMode="decimal" className={INPUT} value={f.daily} onChange={(ev) => set(l.name, "daily", ev.target.value)} />
              </Field>
            </div>
          </Card>
        );
      })}

      <Card title="Validation">
        {result.ok && live ? (
          <div className="space-y-2 text-sm">
            <Message kind="ok">Valid. A round trip keeps at most {pct}% of the amount (rates and percentage fees, before rounding and flat fees) — under 100%, so nobody can profit by converting back and forth.</Message>
            {example ? (
              <p className="text-xs text-muted-foreground">
                Example with the real rounding: {usd(example.fcIn)} → {fgc(example.fgc)} → {example.fcBack === null ? "outside the FGC → FC limits" : `${usd(example.fcBack)} (${example.percent}%)`}.
              </p>
            ) : null}
          </div>
        ) : result.ok ? null : result.rules ? (
          <Message kind="error">{result.rules}</Message>
        ) : (
          <Message kind="info">Fill in every box in both directions to check the rules.</Message>
        )}
      </Card>

      <div className="sticky bottom-3 z-10 rounded-2xl border border-border bg-card/95 p-3 shadow-card backdrop-blur">
        {msg ? <div className="mb-3"><Message kind={msg.kind}>{msg.text}</Message></div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{dirty ? (result.ok ? "Unsaved changes" : "Fix the rules before saving") : "No changes"} · saving asks for your password</span>
          <div className="flex gap-2">
            <button type="button" className={`${BTN} border border-border`} disabled={busy || !dirty} onClick={() => { setForm(formFromRules(stored)); setMsg(null); }}>
              Discard
            </button>
            <button type="button" className={`${BTN} bg-foreground text-background`} disabled={busy || !dirty || !result.ok} aria-busy={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save conversion rules"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
