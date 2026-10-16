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
  formats?: FormatRow[];
  /** 0240: null until the migration runs */
  views?: ViewsAdmin | null;
}
/** 0208: a creative format's media limits (columns added by 0208 are absent until it runs) */
interface FormatRow {
  code: string;
  name: string;
  media_types: string[];
  width: number | null;
  height: number | null;
  max_width: number;
  max_height: number;
  min_width: number | null;
  min_height: number | null;
  max_file_bytes: number;
  max_duration_seconds: number | null;
  max_upload_bytes?: number | null;
  delivery_long_edge?: number;
  image_quality?: number;
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

      {p?.views ? (
        <ViewsPricing v={p.views} busy={busy} setBusy={setBusy} setNote={setNote} onSaved={(views) => setP((x) => (x ? { ...x, views } : x))} />
      ) : p ? (
        <p className="text-xs text-muted-foreground">Views-based campaigns appear here once migration 0240 has run.</p>
      ) : null}
      {p?.formats?.length ? <CreativeFormats formats={p.formats} busy={busy} send={send} reload={load} /> : null}
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

/**
 * Creative formats (0208): the limits every upload, preview and server check
 * reads — recommended size (advice), upload caps (any orientation), what is
 * served (long edge, quality, file size), video length, and which media a
 * format takes. A change applies to the next upload; live creatives are not
 * re-judged.
 */
function CreativeFormats({ formats, busy, send, reload }: { formats: FormatRow[]; busy: boolean; send: Send; reload: () => Promise<void> }) {
  const MB = 1024 * 1024;
  const save = async (code: string, patch: Partial<FormatRow>, label: string) => {
    if (await send("PATCH", "/api/admin/ads/platform", { format: { code, ...patch } }, `Saved: ${label}.`)) await reload();
  };
  return (
    <section className={box}>
      <h3 className="text-sm font-semibold">Creative formats — media limits</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Creatives are never refused for their shape: they are shown whole inside the slot. Larger images are resized in the advertiser&apos;s browser; larger videos are
        transcoded by Cloudflare Stream. These numbers apply to the next upload.
      </p>
      <div className="mt-3 space-y-4">
        {formats.map((f) => {
          const migrated = f.delivery_long_edge !== undefined;
          return (
            <div key={f.code} className="rounded-xl border border-border/60 p-3">
              <p className="text-sm font-semibold">
                {f.name} <span className="font-mono text-[11px] text-muted-foreground">{f.code}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                {(["image", "video"] as const).map((m) => (
                  <label key={m} className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={f.media_types.includes(m)}
                      disabled={busy || (f.media_types.length === 1 && f.media_types.includes(m))}
                      onChange={(e) => void save(f.code, { media_types: e.target.checked ? [...f.media_types, m] : f.media_types.filter((x) => x !== m) }, `${f.name} media`)}
                    />
                    {m === "image" ? "Images" : "Videos"}
                  </label>
                ))}
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <NumberField label="Recommended width (px, advice)" min={1} max={10000} value={f.width ?? 0} disabled={busy} onSave={(v) => void save(f.code, { width: v }, `${f.name} recommended width`)} />
                <NumberField label="Recommended height (px, advice)" min={1} max={10000} value={f.height ?? 0} disabled={busy} onSave={(v) => void save(f.code, { height: v }, `${f.name} recommended height`)} />
                <NumberField label="Upload cap — short edge (px)" min={16} max={8192} value={Math.min(f.max_width, f.max_height)} disabled={busy} onSave={(v) => void save(f.code, f.max_width <= f.max_height ? { max_width: v } : { max_height: v }, `${f.name} upload cap`)} />
                <NumberField label="Upload cap — long edge (px)" min={16} max={8192} value={Math.max(f.max_width, f.max_height)} disabled={busy} onSave={(v) => void save(f.code, f.max_width <= f.max_height ? { max_height: v } : { max_width: v }, `${f.name} upload cap`)} />
                <NumberField label="Served file size (MB)" min={1} max={200} value={Math.round(f.max_file_bytes / MB)} disabled={busy} onSave={(v) => void save(f.code, { max_file_bytes: v * MB }, `${f.name} served size`)} />
                {f.media_types.includes("video") ? (
                  <NumberField label="Video length (seconds)" min={1} max={600} value={f.max_duration_seconds ?? 0} disabled={busy} onSave={(v) => void save(f.code, { max_duration_seconds: v }, `${f.name} video length`)} />
                ) : null}
                <NumberField label="Served long edge (px)" min={240} max={3840} value={f.delivery_long_edge ?? 1280} disabled={busy || !migrated} onSave={(v) => void save(f.code, { delivery_long_edge: v }, `${f.name} served size`)} />
                <NumberField label="Image quality (40–100)" min={40} max={100} value={f.image_quality ?? 82} disabled={busy || !migrated} onSave={(v) => void save(f.code, { image_quality: v }, `${f.name} image quality`)} />
                {f.media_types.includes("video") ? (
                  <NumberField label="Video upload cap before transcoding (MB)" min={1} max={2048} value={Math.round((f.max_upload_bytes ?? f.max_file_bytes) / MB)} disabled={busy || !migrated} onSave={(v) => void save(f.code, { max_upload_bytes: v * MB }, `${f.name} upload size`)} />
                ) : null}
              </div>
              {!migrated ? <p className="mt-2 text-[11.5px] text-amber-700">Served size, quality and the video upload cap appear after migration 0208 is run.</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BlockedDomains({ list, busy, send, reload }: { list: Platform["blocked"]; busy: boolean; send: Send; reload: () => Promise<void> }) {
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");
  return (
    <section className={box}>
      <h3 className="text-sm font-semibold">Blocked destinations</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">An ad may never link here — the domain and every subdomain. Checked whenever a link is submitted or changed. Blocking also pauses any live ad that links there (Traffic &amp; safety shows it).</p>
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

/**
 * Views-based campaigns (0240): sold as qualifying views, delivered in a planned
 * period and extended free until the target is met. Every number applies to the
 * NEXT quote only — a campaign already priced keeps the terms it was sold on.
 * Rates are US cents per 1,000 views (owner 2026-10-12: the minimum views are
 * the admin's to set).
 */
interface ViewsAdmin {
  settings: {
    views_enabled: boolean;
    views_rate_per_1000_minor: number;
    views_min_target: number;
    views_max_target: number;
    views_target_step: number;
    views_auto_extend: boolean;
    views_extension_days: number;
    views_max_extensions: number;
    views_capacity_policy: "allow" | "review" | "block";
    views_capacity_window_days: number;
    /* 0242 (absent until it runs) */
    fixed_enabled?: boolean;
    views_min_checkout_minor?: number;
    views_volume_tiers?: { min_views: number; rate_per_1000_minor: number }[];
    views_extend_when_advertiser_paused?: boolean;
    views_suspension_policy?: "close_refund" | "hold_review";
    views_on_exhausted?: "review" | "close_refund";
    views_review_after_extensions?: number;
  };
  placements: { code: string; name: string; views_enabled: boolean; views_rate_per_1000_minor: number | null }[];
  durations: { id: string; name: string; duration_days: number; enabled: boolean; views_enabled: boolean }[];
  migrated0242?: boolean;
}
type ViewsPatch = {
  settings?: Partial<ViewsAdmin["settings"]>;
  placement?: { code: string; views_enabled?: boolean; views_rate_per_1000_minor?: number | null };
  duration?: { id: string; views_enabled: boolean };
  newDuration?: { days: number; name: string };
};
type Note = { tone: "ok" | "bad"; text: string } | null;

/**
 * Advertising Pricing & Delivery (Part 3, 0240–0242): both ways to buy, the
 * views terms, placement rates, volume tiers, campaign periods and the delivery
 * guarantee's rules. Every change is checked on the server, applies to NEW
 * quotes only (a priced campaign keeps the terms it was sold on), and is
 * recorded in the config audit log with the admin, the old and the new value.
 */
function ViewsPricing({ v, busy, setBusy, setNote, onSaved }: { v: ViewsAdmin; busy: boolean; setBusy: (b: boolean) => void; setNote: (n: Note) => void; onSaved: (next: ViewsAdmin) => void }) {
  const s = v.settings;
  const m42 = v.migrated0242 === true;
  const save = async (patch: ViewsPatch, label: string) => {
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/admin/ads/platform", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ views: patch }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { views?: ViewsAdmin | null; error?: string } | null;
    setBusy(false);
    if (res?.ok && j?.views) {
      onSaved(j.views);
      setNote({ tone: "ok", text: `Saved: ${label}.` });
    } else setNote({ tone: "bad", text: j?.error ?? "Couldn't save that. Nothing changed." });
  };
  const smallest = Math.floor((s.views_min_target * s.views_rate_per_1000_minor) / 1000);
  const select = "mt-1 block w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground";
  return (
    <section className={box}>
      <h3 className="text-sm font-semibold">Advertising Pricing &amp; Delivery</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Every change applies to new quotes only — a campaign already priced keeps its terms. Switching a way to buy off stops new sales; running campaigns keep serving. Every change is audited.
      </p>

      <h4 className="mt-3 text-xs font-semibold">Ways to buy</h4>
      <div className="mt-1 flex items-center gap-3 py-1.5">
        <span className="flex-1 text-sm font-medium">By days (fixed period)</span>
        <Switch on={s.fixed_enabled !== false} label="Sell campaigns by days" disabled={busy || !m42} onChange={(on) => void save({ settings: { fixed_enabled: on } }, "campaigns by days")} />
      </div>
      <div className="flex items-center gap-3 py-1.5">
        <span className="flex-1 text-sm font-medium">By views (guaranteed delivery)</span>
        <Switch on={s.views_enabled} label="Sell views-based campaigns" disabled={busy} onChange={(on) => void save({ settings: { views_enabled: on } }, "views-based campaigns")} />
      </div>
      <p className="text-[11.5px] text-muted-foreground">Both on: advertisers choose. At least one must stay on. Currency: US dollars (the checkout converts as today).</p>

      <h4 className="mt-4 text-xs font-semibold">Views</h4>
      <div className="mt-1 grid gap-3 sm:grid-cols-2">
        <NumberField label="Minimum views per campaign" min={1} max={100000000} value={s.views_min_target} disabled={busy} onSave={(n) => void save({ settings: { views_min_target: n } }, "minimum views")} />
        <NumberField label="Maximum views per campaign" min={1} max={100000000} value={s.views_max_target} disabled={busy} onSave={(n) => void save({ settings: { views_max_target: n } }, "maximum views")} />
        <NumberField label="Views are bought in steps of" min={1} max={1000000} value={s.views_target_step} disabled={busy} onSave={(n) => void save({ settings: { views_target_step: n } }, "views step")} />
        <NumberField label="Base rate per 1,000 views (US cents)" min={1} max={10000000} value={s.views_rate_per_1000_minor} disabled={busy} onSave={(n) => void save({ settings: { views_rate_per_1000_minor: n } }, "base rate")} />
        <NumberField label="Minimum checkout (US cents, 0 = none)" min={0} max={100000000} value={s.views_min_checkout_minor ?? 0} disabled={busy || !m42} onSave={(n) => void save({ settings: { views_min_checkout_minor: n } }, "minimum checkout")} />
      </div>
      <p className="mt-2 text-[11.5px] text-muted-foreground">The smallest campaign costs ${(smallest / 100).toFixed(2)} at the base rate.</p>

      <Tiers tiers={s.views_volume_tiers ?? []} disabled={busy || !m42} onSave={(t) => void save({ settings: { views_volume_tiers: t } }, "volume tiers")} />

      <h4 className="mt-4 text-xs font-semibold">Delivery guarantee</h4>
      <div className="mt-1 flex items-center gap-3 py-1.5">
        <span className="flex-1 text-sm">Extend free until the target is met</span>
        <Switch on={s.views_auto_extend} label="Extend free until the target is met" disabled={busy} onChange={(on) => void save({ settings: { views_auto_extend: on } }, "free extension")} />
      </div>
      <div className="flex items-center gap-3 py-1.5">
        <span className="flex-1 text-sm">An advertiser&apos;s own pause still earns an extension</span>
        <Switch on={s.views_extend_when_advertiser_paused !== false} label="Advertiser pause earns an extension" disabled={busy || !m42} onChange={(on) => void save({ settings: { views_extend_when_advertiser_paused: on } }, "advertiser pause rule")} />
      </div>
      <div className="mt-1 grid gap-3 sm:grid-cols-2">
        <NumberField label="Free extension length (days)" min={1} max={90} value={s.views_extension_days} disabled={busy} onSave={(n) => void save({ settings: { views_extension_days: n } }, "extension length")} />
        <NumberField label="Most free extensions per campaign" min={0} max={52} value={s.views_max_extensions} disabled={busy} onSave={(n) => void save({ settings: { views_max_extensions: n } }, "extension limit")} />
        <label className="text-[11.5px] text-muted-foreground">
          When the free extensions run out →
          <select value={s.views_on_exhausted ?? "review"} disabled={busy || !m42} onChange={(e) => void save({ settings: { views_on_exhausted: e.target.value as "review" | "close_refund" } }, "after the last extension")} className={select}>
            <option value="review">Hold it for an admin to decide (recommended)</option>
            <option value="close_refund">Close it and owe the undelivered share</option>
          </select>
        </label>
        <label className="text-[11.5px] text-muted-foreground">
          A campaign suspended by Frenzsave at its deadline →
          <select value={s.views_suspension_policy ?? "close_refund"} disabled={busy || !m42} onChange={(e) => void save({ settings: { views_suspension_policy: e.target.value as "close_refund" | "hold_review" } }, "suspension rule")} className={select}>
            <option value="close_refund">Close it and owe the undelivered share</option>
            <option value="hold_review">Hold it for an admin to decide</option>
          </select>
        </label>
        <NumberField label="Flag for review after this many extensions (0 = off)" min={0} max={52} value={s.views_review_after_extensions ?? 0} disabled={busy || !m42} onSave={(n) => void save({ settings: { views_review_after_extensions: n } }, "review threshold")} />
      </div>

      <h4 className="mt-4 text-xs font-semibold">Capacity</h4>
      <div className="mt-1 grid gap-3 sm:grid-cols-2">
        <NumberField label="Capacity estimate looks back (days)" min={1} max={90} value={s.views_capacity_window_days} disabled={busy} onSave={(n) => void save({ settings: { views_capacity_window_days: n } }, "capacity window")} />
        <label className="text-[11.5px] text-muted-foreground">
          When a target may not fit the measured views →
          <select value={s.views_capacity_policy} disabled={busy} onChange={(e) => void save({ settings: { views_capacity_policy: e.target.value as ViewsAdmin["settings"]["views_capacity_policy"] } }, "capacity policy")} className={select}>
            <option value="review">Sell it, then hold it for an admin</option>
            <option value="block">Refuse it (no history yet: hold for an admin)</option>
            <option value="allow">Sell it anyway</option>
          </select>
        </label>
      </div>
      {!m42 ? <p className="mt-2 text-[11.5px] font-semibold text-amber-700">The greyed controls appear once migration 0242 has run.</p> : null}

      <h4 className="mt-4 text-xs font-semibold">Per placement (no own rate = the base rate or tier)</h4>
      <ul className="mt-1 divide-y divide-border/60">
        {v.placements.map((p) => (
          <li key={p.code} className="flex flex-wrap items-end gap-3 py-2">
            <span className="min-w-[8rem] flex-1 text-sm">{p.name}</span>
            <div className="w-48">
              <NumberField label="Rate (US cents / 1,000 views)" min={1} max={10000000} value={p.views_rate_per_1000_minor ?? s.views_rate_per_1000_minor} disabled={busy} onSave={(n) => void save({ placement: { code: p.code, views_rate_per_1000_minor: n } }, `${p.name} rate`)} />
            </div>
            {p.views_rate_per_1000_minor !== null ? (
              <button type="button" disabled={busy} onClick={() => void save({ placement: { code: p.code, views_rate_per_1000_minor: null } }, `${p.name} rate`)} className="min-h-[2rem] rounded-lg border border-border px-2.5 text-xs font-semibold disabled:opacity-40">
                Use base rate
              </button>
            ) : null}
            <Switch on={p.views_enabled} label={`${p.name} sells views`} disabled={busy} onChange={(on) => void save({ placement: { code: p.code, views_enabled: on } }, p.name)} />
          </li>
        ))}
      </ul>

      <h4 className="mt-4 text-xs font-semibold">Planned periods for views campaigns</h4>
      <p className="text-[11.5px] text-muted-foreground">A switched-off length is never offered for a new purchase; campaigns already running keep theirs. Lengths for campaigns by days are switched in Ad placements.</p>
      <ul className="mt-1 divide-y divide-border/60">
        {v.durations.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-2">
            <span className="flex-1 text-sm">
              {d.name}
              {d.enabled ? "" : " (length switched off)"}
            </span>
            <Switch on={d.views_enabled} label={`${d.name} for views campaigns`} disabled={busy} onChange={(on) => void save({ duration: { id: d.id, views_enabled: on } }, d.name)} />
          </li>
        ))}
      </ul>
      <NewDuration disabled={busy} existing={v.durations.map((d) => d.duration_days)} onAdd={(days, name) => void save({ newDuration: { days, name } }, `new length ${name}`)} />
    </section>
  );
}

/** Volume tiers: a lower rate from a number of views up. Edited locally, saved once. */
function Tiers({ tiers, disabled, onSave }: { tiers: { min_views: number; rate_per_1000_minor: number }[]; disabled: boolean; onSave: (t: { min_views: number; rate_per_1000_minor: number }[]) => void }) {
  const [rows, setRows] = useState(tiers.map((t) => ({ min: String(t.min_views), rate: String(t.rate_per_1000_minor) })));
  useEffect(() => setRows(tiers.map((t) => ({ min: String(t.min_views), rate: String(t.rate_per_1000_minor) }))), [tiers]);
  const parsed = rows.map((r) => ({ min_views: Number(r.min), rate_per_1000_minor: Number(r.rate) }));
  const valid = parsed.every((t) => Number.isInteger(t.min_views) && t.min_views >= 1 && Number.isInteger(t.rate_per_1000_minor) && t.rate_per_1000_minor >= 1);
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold">Volume tiers</p>
      <p className="text-[11.5px] text-muted-foreground">From a number of views up, a lower rate (US cents per 1,000). A placement&apos;s own rate wins over a tier. The server refuses a bigger tier that costs more.</p>
      <ul className="mt-1 space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
            From
            <input inputMode="numeric" value={r.min} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)))} className="w-28 rounded-lg border border-border bg-background px-2 py-1.5" aria-label="From views" />
            views →
            <input inputMode="numeric" value={r.rate} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} className="w-20 rounded-lg border border-border bg-background px-2 py-1.5" aria-label="Cents per 1,000" />
            ¢ / 1,000
            <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="min-h-[2rem] px-1.5 font-semibold text-rose-600">
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex gap-2">
        <button type="button" disabled={disabled || rows.length >= 10} onClick={() => setRows([...rows, { min: "", rate: "" }])} className="min-h-[2rem] rounded-lg border border-border px-2.5 text-xs font-semibold disabled:opacity-40">
          Add tier
        </button>
        <button type="button" disabled={disabled || !valid} onClick={() => onSave(parsed)} className="min-h-[2rem] rounded-lg border border-border px-2.5 text-xs font-semibold disabled:opacity-40">
          Save tiers
        </button>
      </div>
    </div>
  );
}

function NewDuration({ disabled, existing, onAdd }: { disabled: boolean; existing: number[]; onAdd: (days: number, name: string) => void }) {
  const [days, setDays] = useState("");
  const n = Number(days);
  const ok = Number.isInteger(n) && n >= 1 && n <= 366 && !existing.includes(n);
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
      <label className="text-[11.5px] text-muted-foreground">
        Add a length (days)
        <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} className="mt-1 block w-24 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground" />
      </label>
      <button type="button" disabled={disabled || !ok} onClick={() => { onAdd(n, `${n} ${n === 1 ? "day" : "days"}`); setDays(""); }} className="min-h-[2rem] rounded-lg border border-border px-2.5 font-semibold disabled:opacity-40">
        Add
      </button>
      {days && existing.includes(n) ? <span className="text-muted-foreground">That length exists — switch it on above.</span> : null}
    </div>
  );
}
