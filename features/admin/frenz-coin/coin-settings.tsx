"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { COIN_ADMIN_ALERTS, type CoinAdminAlerts, type FrenzCoinConfig } from "@/lib/coin/config";

import { buildCoinPatch, type CoinSettingsForm, formFromConfig, riskyChanges } from "./coin-admin-logic";
import { postMoney } from "./coin-admin-data";
import { BTN, Card, Field, INPUT, Message, Toggle, when } from "./coin-admin-ui";

type SensitiveFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

const ALERT_LABEL: Record<CoinAdminAlerts, string> = { both: "Push and email", push: "Push only", email: "Email only", off: "Off" };

/**
 * Admin → Frenz Coin → Settings (Part 6). Every switch, fee, limit and the payout rate source the backend supports —
 * nothing else. Saved through the audited settings API (POST /api/admin/landing { frenzCoin }), which asks for a fresh
 * password on any coin change, normalises and clamps again, bumps the config version and writes the audit trail.
 * Only the fields that changed are sent. Risky changes (switching Frenz Coin on or off, the payout rate, fees, the hold)
 * are listed and must be confirmed first.
 */
export function CoinSettings({ config, sensitiveFetch }: { config: FrenzCoinConfig; sensitiveFetch: SensitiveFetch }) {
  const router = useRouter();
  const [base, setBase] = useState(config);
  const [form, setForm] = useState<CoinSettingsForm>(() => formFromConfig(config));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const result = useMemo(() => buildCoinPatch(form, base), [form, base]);
  const errs = useMemo(() => (result.ok ? {} : Object.fromEntries(result.problems.map((p) => [p.field, p.message]))), [result]);
  const risky = result.ok ? riskyChanges(result.changes, form) : [];
  const dirty = result.ok ? result.changes.length > 0 : true;

  const set = <K extends keyof CoinSettingsForm>(k: K, v: CoinSettingsForm[K]) => {
    setMsg(null);
    setConfirming(false);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const sub = <K extends "deposits" | "transfers" | "withdrawals" | "pin">(k: K, patch: Partial<CoinSettingsForm[K]>) => set(k, { ...form[k], ...patch });

  const save = async () => {
    if (!result.ok || !result.changes.length || busy) return;
    if (risky.length && !confirming) return setConfirming(true);
    setBusy(true);
    setMsg(null);
    const r = await postMoney<{ ok?: boolean }>(sensitiveFetch, "/api/admin/landing", { frenzCoin: result.patch });
    setBusy(false);
    setConfirming(false);
    if (!r.ok) return setMsg({ kind: "error", text: r.error });
    // the server's normalised value is the truth: re-read the page's settings, and treat what was sent as the new base
    setBase((b) => mergeBase(b, result.patch));
    setMsg({ kind: "ok", text: `Saved ${result.changes.length} change${result.changes.length === 1 ? "" : "s"}. Recorded in the audit log.` });
    router.refresh();
  };

  const d = form.deposits;
  const t = form.transfers;
  const w = form.withdrawals;
  const p = form.pin;

  return (
    <div className="space-y-5">
      <Card title="Frenz Coin" action={<span className="text-xs text-muted-foreground">Version {base.version} · {base.updatedAt ? `changed ${when(base.updatedAt)}` : "never changed"}</span>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Toggle id="fc-enabled" label="Frenz Coin is on for members" checked={form.enabled} onChange={(v) => set("enabled", v)} hint="Master switch. Off hides every wallet entry point and every coin route refuses." />
          <Field htmlFor="fc-alerts" label="Admin alerts for transfers and withdrawals" hint="Each one, with the fee earned. Deposits already alert through funding alerts.">
            <select id="fc-alerts" className={INPUT} value={form.adminAlerts} onChange={(e) => set("adminAlerts", e.target.value as CoinAdminAlerts)}>
              {COIN_ADMIN_ALERTS.map((a) => (
                <option key={a} value={a}>
                  {ALERT_LABEL[a]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Card>

      <Card title="Deposits">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Toggle id="fc-dep-on" label="Deposits on" checked={d.enabled} onChange={(v) => sub("deposits", { enabled: v })} />
          <Field htmlFor="fc-dep-hold" label="Hold (hours)" hint="0 to 2160. Coins are pending until it ends." error={errs["deposits.holdHours"]}>
            <input id="fc-dep-hold" inputMode="numeric" className={INPUT} value={d.holdHours} onChange={(e) => sub("deposits", { holdHours: e.target.value })} />
          </Field>
          <Field htmlFor="fc-dep-min" label="Smallest deposit ($)" error={errs["deposits.min"]}>
            <input id="fc-dep-min" inputMode="decimal" className={INPUT} value={d.min} onChange={(e) => sub("deposits", { min: e.target.value })} />
          </Field>
          <Field htmlFor="fc-dep-max" label="Largest deposit ($)" error={errs["deposits.max"]}>
            <input id="fc-dep-max" inputMode="decimal" className={INPUT} value={d.max} onChange={(e) => sub("deposits", { max: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card title="Transfers">
        <p className="mb-3 text-xs text-muted-foreground">The sender pays the fee on top: a percentage of the amount plus a flat fee that depends on the bracket. Under the lower threshold → lower flat fee; up to and including the upper threshold → middle flat fee; above it → upper flat fee.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Toggle id="fc-tx-on" label="Transfers on" checked={t.enabled} onChange={(v) => sub("transfers", { enabled: v })} />
          <Field htmlFor="fc-tx-pct" label="Fee (%)" hint="0 to 50" error={errs["transfers.percent"]}>
            <input id="fc-tx-pct" inputMode="decimal" className={INPUT} value={t.percent} onChange={(e) => sub("transfers", { percent: e.target.value })} />
          </Field>
          <Field htmlFor="fc-tx-low" label="Lower threshold ($)" error={errs["transfers.low"]}>
            <input id="fc-tx-low" inputMode="decimal" className={INPUT} value={t.low} onChange={(e) => sub("transfers", { low: e.target.value })} />
          </Field>
          <Field htmlFor="fc-tx-high" label="Upper threshold ($)" error={errs["transfers.high"]}>
            <input id="fc-tx-high" inputMode="decimal" className={INPUT} value={t.high} onChange={(e) => sub("transfers", { high: e.target.value })} />
          </Field>
          <Field htmlFor="fc-tx-fb" label="Flat fee under lower ($)" error={errs["transfers.flatBelow"]}>
            <input id="fc-tx-fb" inputMode="decimal" className={INPUT} value={t.flatBelow} onChange={(e) => sub("transfers", { flatBelow: e.target.value })} />
          </Field>
          <Field htmlFor="fc-tx-fm" label="Flat fee between ($)" error={errs["transfers.flatMid"]}>
            <input id="fc-tx-fm" inputMode="decimal" className={INPUT} value={t.flatMid} onChange={(e) => sub("transfers", { flatMid: e.target.value })} />
          </Field>
          <Field htmlFor="fc-tx-fa" label="Flat fee above upper ($)" error={errs["transfers.flatAbove"]}>
            <input id="fc-tx-fa" inputMode="decimal" className={INPUT} value={t.flatAbove} onChange={(e) => sub("transfers", { flatAbove: e.target.value })} />
          </Field>
          <Field htmlFor="fc-tx-min" label="Smallest transfer ($)" error={errs["transfers.min"]}>
            <input id="fc-tx-min" inputMode="decimal" className={INPUT} value={t.min} onChange={(e) => sub("transfers", { min: e.target.value })} />
          </Field>
          <Field htmlFor="fc-tx-max" label="Largest transfer ($)" error={errs["transfers.max"]}>
            <input id="fc-tx-max" inputMode="decimal" className={INPUT} value={t.max} onChange={(e) => sub("transfers", { max: e.target.value })} />
          </Field>
          <Field htmlFor="fc-tx-day" label="Daily limit per member ($)" error={errs["transfers.dailyMax"]}>
            <input id="fc-tx-day" inputMode="decimal" className={INPUT} value={t.dailyMax} onChange={(e) => sub("transfers", { dailyMax: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card title="Withdrawals">
        <p className="mb-3 text-xs text-muted-foreground">The fee is taken from the amount withdrawn. Every request is held, reviewed and paid by an administrator.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Toggle id="fc-wd-on" label="Withdrawals on" checked={w.enabled} onChange={(v) => sub("withdrawals", { enabled: v })} />
          <Field htmlFor="fc-wd-pct" label="Fee (%)" hint="0 to 50" error={errs["withdrawals.percent"]}>
            <input id="fc-wd-pct" inputMode="decimal" className={INPUT} value={w.percent} onChange={(e) => sub("withdrawals", { percent: e.target.value })} />
          </Field>
          <Field htmlFor="fc-wd-flat" label="Flat fee ($)" error={errs["withdrawals.flat"]}>
            <input id="fc-wd-flat" inputMode="decimal" className={INPUT} value={w.flat} onChange={(e) => sub("withdrawals", { flat: e.target.value })} />
          </Field>
          <Field htmlFor="fc-wd-min" label="Smallest withdrawal ($)" error={errs["withdrawals.min"]}>
            <input id="fc-wd-min" inputMode="decimal" className={INPUT} value={w.min} onChange={(e) => sub("withdrawals", { min: e.target.value })} />
          </Field>
          <Field htmlFor="fc-wd-max" label="Largest withdrawal ($)" error={errs["withdrawals.max"]}>
            <input id="fc-wd-max" inputMode="decimal" className={INPUT} value={w.max} onChange={(e) => sub("withdrawals", { max: e.target.value })} />
          </Field>
          <Field htmlFor="fc-wd-day" label="Requests per day" error={errs["withdrawals.maxPerDay"]}>
            <input id="fc-wd-day" inputMode="numeric" className={INPUT} value={w.maxPerDay} onChange={(e) => sub("withdrawals", { maxPerDay: e.target.value })} />
          </Field>
          <Field htmlFor="fc-wd-month" label="Monthly limit per member ($)" error={errs["withdrawals.maxMonth"]}>
            <input id="fc-wd-month" inputMode="decimal" className={INPUT} value={w.maxMonth} onChange={(e) => sub("withdrawals", { maxMonth: e.target.value })} />
          </Field>
          <div className="flex flex-col gap-2">
            <Toggle id="fc-wd-email" label="Confirmed email required" checked={w.requireEmailConfirmed} onChange={(v) => sub("withdrawals", { requireEmailConfirmed: v })} />
            <Toggle id="fc-wd-qual" label="Reward qualification required" checked={w.requireQualification} onChange={(v) => sub("withdrawals", { requireQualification: v })} />
          </div>
        </div>

        <fieldset className="mt-5 rounded-2xl border border-border p-4">
          <legend className="px-1 text-sm font-semibold">Payout rate (naira)</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["none", "None", "Withdrawals can be requested but no bank payout is sent. Members see that withdrawals aren't open yet."],
                ["fixed", "Fixed", "Use the approved rate below. It is recorded on each withdrawal when requested and never changes for it."],
                ["market", "Market", "Use the live market rate the AI-credit and SUB payouts already use, read when paying (no markup). Recorded on the withdrawal before anything is sent."],
              ] as const
            ).map(([v, label, hint]) => (
              <label key={v} htmlFor={`fc-rate-${v}`} className={`flex cursor-pointer gap-2 rounded-xl border p-3 text-sm ${w.rateSource === v ? "border-primary bg-primary/5" : "border-border"}`}>
                <input id={`fc-rate-${v}`} type="radio" name="fc-rate" value={v} checked={w.rateSource === v} onChange={() => sub("withdrawals", { rateSource: v })} className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{label}</span>
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          {w.rateSource === "fixed" ? (
            <div className="mt-3 max-w-xs">
              <Field htmlFor="fc-rate-value" label="Approved rate: naira per $1" hint="Enter the rate you approved. There is no default." error={errs["withdrawals.nairaPerUsd"]}>
                <input id="fc-rate-value" inputMode="decimal" placeholder="e.g. the rate you approved" className={INPUT} value={w.nairaPerUsd} onChange={(e) => sub("withdrawals", { nairaPerUsd: e.target.value })} />
              </Field>
            </div>
          ) : null}
        </fieldset>
      </Card>

      <Card title="Transaction PIN">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Field htmlFor="fc-pin-att" label="Wrong tries before a lock" hint="3 to 10" error={errs["pin.maxAttempts"]}>
            <input id="fc-pin-att" inputMode="numeric" className={INPUT} value={p.maxAttempts} onChange={(e) => sub("pin", { maxAttempts: e.target.value })} />
          </Field>
          <Field htmlFor="fc-pin-lock" label="First lock (minutes)" hint="5 to 1440, doubles" error={errs["pin.lockMinutes"]}>
            <input id="fc-pin-lock" inputMode="numeric" className={INPUT} value={p.lockMinutes} onChange={(e) => sub("pin", { lockMinutes: e.target.value })} />
          </Field>
          <Field htmlFor="fc-pin-ttl" label="Reset code lifetime (min)" hint="5 to 30" error={errs["pin.resetTtlMinutes"]}>
            <input id="fc-pin-ttl" inputMode="numeric" className={INPUT} value={p.resetTtlMinutes} onChange={(e) => sub("pin", { resetTtlMinutes: e.target.value })} />
          </Field>
          <Field htmlFor="fc-pin-hour" label="Reset codes per hour" hint="1 to 10" error={errs["pin.resetMaxPerHour"]}>
            <input id="fc-pin-hour" inputMode="numeric" className={INPUT} value={p.resetMaxPerHour} onChange={(e) => sub("pin", { resetMaxPerHour: e.target.value })} />
          </Field>
          <Field htmlFor="fc-pin-code" label="Tries per reset code" hint="3 to 10" error={errs["pin.resetCodeMaxAttempts"]}>
            <input id="fc-pin-code" inputMode="numeric" className={INPUT} value={p.resetCodeMaxAttempts} onChange={(e) => sub("pin", { resetCodeMaxAttempts: e.target.value })} />
          </Field>
        </div>
      </Card>

      <div className="sticky bottom-3 z-10 rounded-2xl border border-border bg-card/95 p-3 shadow-card backdrop-blur">
        {confirming && risky.length ? (
          <div className="mb-3 space-y-1.5 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200" role="alert">
            <p className="font-semibold">Confirm these changes</p>
            <ul className="list-disc pl-5">
              {risky.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {msg ? <div className="mb-3"><Message kind={msg.kind}>{msg.text}</Message></div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{!result.ok ? `${result.problems.length} field${result.problems.length === 1 ? "" : "s"} to fix` : dirty ? `${result.changes.length} unsaved change${result.changes.length === 1 ? "" : "s"}` : "No changes"} · saving asks for your password</span>
          <div className="flex gap-2">
            <button type="button" className={`${BTN} border border-border`} disabled={busy || !dirty} onClick={() => { setForm(formFromConfig(base)); setConfirming(false); setMsg(null); }}>
              Discard
            </button>
            <button type="button" className={`${BTN} bg-foreground text-background`} disabled={busy || !result.ok || !dirty} aria-busy={busy} onClick={() => void save()}>
              {busy ? "Saving…" : confirming ? "Confirm and save" : "Save settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** What was sent becomes the new base, so "unsaved changes" resets without a second read (the page refresh brings the server's own). */
function mergeBase(b: FrenzCoinConfig, patch: Record<string, unknown>): FrenzCoinConfig {
  const out = { ...b } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) out[k] = v && typeof v === "object" ? { ...(out[k] as object), ...(v as object) } : v;
  return out as unknown as FrenzCoinConfig;
}
