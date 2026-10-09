"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { useShownOnce } from "./use-shown-once";

/**
 * Admin → Ads → Self-serve rules (Ad Platform Part 7). The levers Parts 1-6
 * built into the database, finally on screen: the kill switch and policy
 * (ad_platform_settings), what advertisers may change themselves
 * (ad_advertiser_controls), blocked destinations, prices and promotions.
 * Campaign lengths keep their own switches in Ad placements; slots too.
 * Loads when the tab is first shown; each change saves on its own.
 */

interface Settings {
  ads_enabled: boolean;
  applications_open: boolean;
  payments_enabled: boolean;
  default_slot_count: number;
  quote_ttl_minutes: number;
  checkout_honour_hours: number;
  refund_after_start: "remove" | "pause" | "keep";
  chargeback_action: "pause" | "remove";
}
type Controls = { replaceCreative: boolean; editText: boolean; editDestination: boolean; pauseResume: boolean; extensions: boolean };
interface Platform {
  settings: Settings | null;
  controls: Controls;
  blocked: { domain: string; reason: string; createdAt: string }[];
}
interface Pricing {
  placements: { id: string; code: string; name: string; format: string; enabled: boolean }[];
  durations: { id: string; name: string; days: number; enabled: boolean }[];
  prices: { placementId: string; durationId: string; currency: string; priceMinor: number; enabled: boolean }[];
  promotions: Promotion[];
}
interface Promotion {
  id?: string;
  name: string;
  description: string | null;
  placementId: string | null;
  durationId: string | null;
  extraDays: number;
  discountPercent: number;
  startsAt: string | null;
  endsAt: string | null;
  enabled: boolean;
}

const SWITCHES: { key: "ads_enabled" | "applications_open" | "payments_enabled"; label: string; hint: string }[] = [
  { key: "ads_enabled", label: "Self-serve ads serve", hint: "The kill switch. Off: no advertiser ad shows anywhere (within one 5-minute bucket). Network ads are not affected." },
  { key: "applications_open", label: "Applications open", hint: "Off: /advertise stays readable but nobody can submit a new campaign." },
  { key: "payments_enabled", label: "Checkout open", hint: "Off: no new campaign or extension payment can start. Payments already started still settle." },
];
const CONTROLS: { key: keyof Controls; label: string }[] = [
  { key: "replaceCreative", label: "Replace the image or video" },
  { key: "editText", label: "Edit headline and description" },
  { key: "editDestination", label: "Change the link (always re-checked)" },
  { key: "pauseResume", label: "Pause and resume their own campaign" },
  { key: "extensions", label: "Buy more days" },
];

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={cn("relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60", on ? "bg-emerald-500" : "bg-muted")}>
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[1.375rem]" : "left-0.5")} />
    </button>
  );
}

const box = "rounded-2xl border border-border/70 bg-card p-4";

export function AdPlatformControls() {
  const { ref, shown } = useShownOnce<HTMLDivElement>();
  const [p, setP] = useState<Platform | null>(null);
  const [pr, setPr] = useState<Pricing | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function load() {
    const [a, b] = await Promise.all([fetch("/api/admin/ads/platform", { cache: "no-store" }).catch(() => null), fetch("/api/admin/ads/pricing", { cache: "no-store" }).catch(() => null)]);
    if (a?.ok) setP((await a.json()) as Platform);
    if (b?.ok) setPr((await b.json()) as Pricing);
    if (!a?.ok || !b?.ok) setNote({ tone: "bad", text: "Couldn't load everything. Try again." });
  }

  useEffect(() => {
    if (shown) void load();
  }, [shown]);

  async function send(method: string, url: string, body: unknown, ok: string): Promise<boolean> {
    setBusy(true);
    setNote(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const e = (await res?.json().catch(() => null)) as { error?: string } | null;
      setNote({ tone: "bad", text: e?.error ?? "Couldn't save that. Nothing changed." });
      return false;
    }
    setNote({ tone: "ok", text: ok });
    return true;
  }

  async function saveSettings(patch: Partial<Settings>, label: string) {
    if (!p?.settings) return;
    const before = p.settings;
    setP({ ...p, settings: { ...before, ...patch } });
    if (!(await send("PATCH", "/api/admin/ads/platform", { settings: patch }, `Saved: ${label}.`))) setP((x) => (x ? { ...x, settings: before } : x));
  }

  async function saveControl(key: keyof Controls, v: boolean) {
    if (!p) return;
    const before = p.controls;
    setP({ ...p, controls: { ...before, [key]: v } });
    if (!(await send("PATCH", "/api/admin/ads/platform", { controls: { [key]: v } }, "Advertiser controls saved."))) setP((x) => (x ? { ...x, controls: before } : x));
  }

  return (
    <div ref={ref} className="space-y-4">
      {note ? <p className={cn("rounded-xl px-3 py-2 text-xs font-medium", note.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700")}>{note.text}</p> : null}
      {!p || !pr ? <p className="text-xs text-muted-foreground">Loading…</p> : null}

      {p?.settings ? (
        <section className={box}>
          <h3 className="text-sm font-semibold">Switches and policy</h3>
          <ul className="mt-2 divide-y divide-border/60">
            {SWITCHES.map((s) => (
              <li key={s.key} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{s.label}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{s.hint}</span>
                </span>
                <Switch on={p.settings![s.key]} label={s.label} disabled={busy} onChange={(v) => void saveSettings({ [s.key]: v }, s.label)} />
              </li>
            ))}
          </ul>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <NumberField label="Slots per placement (default)" min={1} max={50} value={p.settings.default_slot_count} disabled={busy} onSave={(v) => void saveSettings({ default_slot_count: v }, "slot count")} />
            <NumberField label="A price quote lasts (minutes)" min={5} max={1440} value={p.settings.quote_ttl_minutes} disabled={busy} onSave={(v) => void saveSettings({ quote_ttl_minutes: v }, "quote lifetime")} />
            <NumberField label="Honour a late checkout for (hours)" min={1} max={168} value={p.settings.checkout_honour_hours} disabled={busy} onSave={(v) => void saveSettings({ checkout_honour_hours: v }, "checkout window")} />
            <label className="text-[11.5px] text-muted-foreground">
              Refunded after it started →
              <select value={p.settings.refund_after_start} disabled={busy} onChange={(e) => void saveSettings({ refund_after_start: e.target.value as Settings["refund_after_start"] }, "refund policy")} className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                <option value="remove">Remove the campaign</option>
                <option value="pause">Pause it</option>
                <option value="keep">Keep it running</option>
              </select>
            </label>
            <label className="text-[11.5px] text-muted-foreground">
              On a chargeback →
              <select value={p.settings.chargeback_action} disabled={busy} onChange={(e) => void saveSettings({ chargeback_action: e.target.value as Settings["chargeback_action"] }, "chargeback policy")} className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground">
                <option value="pause">Pause the campaign</option>
                <option value="remove">Remove it</option>
              </select>
            </label>
          </div>
        </section>
      ) : null}

      {p ? (
        <section className={box}>
          <h3 className="text-sm font-semibold">What advertisers may change themselves</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">On a paid campaign, from their dashboard. Off hides the action and the server refuses it.</p>
          <ul className="mt-2 divide-y divide-border/60">
            {CONTROLS.map((c) => (
              <li key={c.key} className="flex items-center gap-3 py-2">
                <span className="flex-1 text-sm">{c.label}</span>
                <Switch on={p.controls[c.key]} label={c.label} disabled={busy} onChange={(v) => void saveControl(c.key, v)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {p ? <BlockedDomains list={p.blocked} busy={busy} send={send} reload={load} /> : null}
      {pr ? <Prices pr={pr} busy={busy} send={send} reload={load} /> : null}
      {pr ? <Promotions pr={pr} busy={busy} send={send} reload={load} /> : null}
    </div>
  );
}

type Send = (method: string, url: string, body: unknown, ok: string) => Promise<boolean>;

function NumberField({ label, min, max, value, disabled, onSave }: { label: string; min: number; max: number; value: number; disabled: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const n = Number(v);
  const valid = Number.isInteger(n) && n >= min && n <= max;
  return (
    <label className="text-[11.5px] text-muted-foreground">
      {label}
      <span className="mt-1 flex gap-1.5">
        <input type="number" inputMode="numeric" min={min} max={max} value={v} onChange={(e) => setV(e.target.value)} className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
        <button type="button" disabled={disabled || !valid || n === value} onClick={() => onSave(n)} className="rounded-lg border border-border px-2.5 text-xs font-semibold text-foreground disabled:opacity-40">
          Save
        </button>
      </span>
    </label>
  );
}

function BlockedDomains({ list, busy, send, reload }: { list: Platform["blocked"]; busy: boolean; send: Send; reload: () => Promise<void> }) {
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");
  return (
    <section className={box}>
      <h3 className="text-sm font-semibold">Blocked destinations</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">An ad may never link here — the domain and every subdomain. Checked whenever a link is submitted or changed. Blocking does not stop an ad already live — remove it from Campaigns.</p>
      <form
        className="mt-2 flex flex-wrap gap-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await send("POST", "/api/admin/ads/platform", { domain, reason: reason || undefined }, `Blocked ${domain}.`)) {
            setDomain("");
            setReason("");
            void reload();
          }
        }}
      >
        <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="example.com" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs" aria-label="Domain" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} placeholder="Why (optional)" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-xs" aria-label="Reason" />
        <button type="submit" disabled={busy || domain.trim().length < 3} className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
          Block
        </button>
      </form>
      <ul className="mt-2 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
        {list.map((b) => (
          <li key={b.domain} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]" title={b.reason}>
            {b.domain}
            <button
              type="button"
              disabled={busy}
              aria-label={`Unblock ${b.domain}`}
              onClick={async () => {
                if (await send("DELETE", `/api/admin/ads/platform?domain=${encodeURIComponent(b.domain)}`, undefined, `Unblocked ${b.domain}.`)) void reload();
              }}
              className="text-muted-foreground hover:text-rose-600"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Prices({ pr, busy, send, reload }: { pr: Pricing; busy: boolean; send: Send; reload: () => Promise<void> }) {
  const price = (pl: string, du: string) => pr.prices.find((x) => x.placementId === pl && x.durationId === du && x.currency === "USD");
  return (
    <section className={box}>
      <h3 className="text-sm font-semibold">Prices (USD)</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">One price per placement and length. No price, or switched off, means it isn&apos;t for sale. A change applies to new quotes; an open quote keeps the price the advertiser saw.</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[11.5px]">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Placement</th>
              {pr.durations.map((d) => (
                <th key={d.id} className={cn("py-1 pr-2 font-medium", !d.enabled && "opacity-50")}>
                  {d.name}
                  {!d.enabled ? " (off)" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pr.placements.map((pl) => (
              <tr key={pl.id} className="border-t border-border/60">
                <td className={cn("py-1.5 pr-2", !pl.enabled && "opacity-50")}>
                  <span className="font-medium">{pl.name}</span> <span className="text-muted-foreground">{pl.format}</span>
                </td>
                {pr.durations.map((d) => (
                  <td key={d.id} className="py-1.5 pr-2">
                    <PriceCell row={price(pl.id, d.id)} busy={busy} onSave={async (minor, enabled) => (await send("PUT", "/api/admin/ads/pricing", { placementId: pl.id, durationId: d.id, currency: "USD", priceMinor: minor, enabled }, `Price saved: ${pl.name}, ${d.name}.`)) && void reload()} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PriceCell({ row, busy, onSave }: { row: Pricing["prices"][number] | undefined; busy: boolean; onSave: (minor: number, enabled: boolean) => void }) {
  const [v, setV] = useState(row ? (row.priceMinor / 100).toFixed(2) : "");
  const minor = Math.round(Number(v) * 100);
  const valid = v.trim() !== "" && Number.isFinite(minor) && minor >= 0;
  const dirty = valid && minor !== (row?.priceMinor ?? -1);
  return (
    <span className="flex items-center gap-1">
      <input value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" placeholder="—" className={cn("w-16 rounded-md border border-border bg-background px-1.5 py-1 text-xs tabular-nums", row && !row.enabled && "line-through opacity-60")} aria-label="Price in dollars" />
      {dirty ? (
        <button type="button" disabled={busy} onClick={() => onSave(minor, true)} className="rounded-md bg-primary px-1.5 py-1 text-[10.5px] font-semibold text-primary-foreground disabled:opacity-50">
          Save
        </button>
      ) : row ? (
        <button type="button" disabled={busy} onClick={() => onSave(row.priceMinor, !row.enabled)} className="rounded-md border border-border px-1.5 py-1 text-[10.5px] font-semibold disabled:opacity-50" title={row.enabled ? "Stop selling at this price" : "Sell at this price again"}>
          {row.enabled ? "On" : "Off"}
        </button>
      ) : null}
    </span>
  );
}

const EMPTY_PROMO: Promotion = { name: "", description: null, placementId: null, durationId: null, extraDays: 0, discountPercent: 10, startsAt: null, endsAt: null, enabled: true };
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function Promotions({ pr, busy, send, reload }: { pr: Pricing; busy: boolean; send: Send; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<Promotion | null>(null);
  const plName = (id: string | null) => (id ? (pr.placements.find((x) => x.id === id)?.name ?? "?") : "Every placement");
  const duName = (id: string | null) => (id ? (pr.durations.find((x) => x.id === id)?.name ?? "?") : "every length");

  async function save(p: Promotion) {
    const { id, ...rest } = p;
    if (await send("POST", "/api/admin/ads/pricing", id ? { id, ...rest } : rest, `Promotion saved: ${p.name}.`)) {
      setDraft(null);
      void reload();
    }
  }

  return (
    <section className={box}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-semibold">Promotions</h3>
        {!draft ? (
          <button type="button" onClick={() => setDraft({ ...EMPTY_PROMO })} className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
            New
          </button>
        ) : null}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">Applied by the database to every quote that matches — the advertiser can&apos;t pick one. The biggest matching discount wins.</p>
      {draft ? (
        <div className="mt-3 grid gap-2 rounded-xl bg-muted/40 p-3 sm:grid-cols-2">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} placeholder="Name (e.g. Launch week)" className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs sm:col-span-2" />
          <select value={draft.placementId ?? ""} onChange={(e) => setDraft({ ...draft, placementId: e.target.value || null })} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
            <option value="">Every placement</option>
            {pr.placements.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select value={draft.durationId ?? ""} onChange={(e) => setDraft({ ...draft, durationId: e.target.value || null })} className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs">
            <option value="">Every length</option>
            {pr.durations.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <label className="text-[11.5px] text-muted-foreground">
            Discount %
            <input type="number" min={0} max={100} value={draft.discountPercent} onChange={(e) => setDraft({ ...draft, discountPercent: Number(e.target.value) })} className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
          </label>
          <label className="text-[11.5px] text-muted-foreground">
            Extra days free
            <input type="number" min={0} max={366} value={draft.extraDays} onChange={(e) => setDraft({ ...draft, extraDays: Number(e.target.value) })} className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
          </label>
          <label className="text-[11.5px] text-muted-foreground">
            Starts (empty = now)
            <input type="datetime-local" value={toLocal(draft.startsAt)} onChange={(e) => setDraft({ ...draft, startsAt: fromLocal(e.target.value) })} className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
          </label>
          <label className="text-[11.5px] text-muted-foreground">
            Ends (empty = no end)
            <input type="datetime-local" value={toLocal(draft.endsAt)} onChange={(e) => setDraft({ ...draft, endsAt: fromLocal(e.target.value) })} className="mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
          </label>
          <div className="flex gap-1.5 sm:col-span-2">
            <button type="button" disabled={busy || !draft.name.trim()} onClick={() => void save(draft)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={() => setDraft(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <ul className="mt-2 divide-y divide-border/60">
        {pr.promotions.map((x) => (
          <li key={x.id} className="flex items-center gap-3 py-2 text-[12px]">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{x.name}</span>
              <span className="block text-[11.5px] text-muted-foreground">
                {x.discountPercent > 0 ? `${x.discountPercent}% off` : ""}
                {x.discountPercent > 0 && x.extraDays > 0 ? " + " : ""}
                {x.extraDays > 0 ? `${x.extraDays} extra days` : ""} · {plName(x.placementId)}, {duName(x.durationId)}
                {x.endsAt ? ` · until ${new Date(x.endsAt).toLocaleDateString()}` : ""}
              </span>
            </span>
            <button type="button" onClick={() => setDraft({ ...x })} className="text-[11px] font-semibold text-muted-foreground underline">
              Edit
            </button>
            <Switch on={x.enabled} label={`${x.name} ${x.enabled ? "on" : "off"}`} disabled={busy} onChange={(v) => void save({ ...x, enabled: v })} />
          </li>
        ))}
        {pr.promotions.length === 0 ? <li className="py-2 text-xs text-muted-foreground">No promotions.</li> : null}
      </ul>
    </section>
  );
}
