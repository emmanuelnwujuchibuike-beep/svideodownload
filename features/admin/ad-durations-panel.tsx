"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Campaign lengths on sale (owner, 2026-10-09: "make admin can turn off a
 * particular ad campaign period such as daily, weekly or monthly"). One switch per
 * length. Off stops NEW sales and extensions of that length; running campaigns
 * keep their dates. The database enforces it (see /api/admin/ads/durations).
 */
type Row = { id: string; name: string; days: number; enabled: boolean; prices: number };

function periodWord(days: number): string {
  if (days === 1) return "Daily";
  if (days === 7) return "Weekly";
  if (days >= 28 && days <= 31) return "Monthly";
  return `${days} days`;
}

export function AdDurationsPanel() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/admin/ads/durations", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ durations: Row[] }>) : Promise.reject()))
      .then((d) => setRows(d.durations))
      .catch(() => setError("Couldn't load the campaign lengths."));
  }, []);

  async function toggle(row: Row) {
    if (busy) return;
    setBusy(row.id);
    setError(null);
    const next = !row.enabled;
    setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, enabled: next } : r)) ?? rs);
    const res = await fetch("/api/admin/ads/durations", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: row.id, enabled: next }) }).catch(() => null);
    if (!res?.ok) {
      setRows((rs) => rs?.map((r) => (r.id === row.id ? { ...r, enabled: row.enabled } : r)) ?? rs);
      setError("Couldn't save that. Nothing changed.");
    }
    setBusy(null);
  }

  return (
    <section className="mb-6 rounded-2xl border border-border/70 bg-card p-4">
      <h3 className="text-sm font-semibold">Campaign lengths on sale</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Switch a period off to stop selling it (new campaigns and extensions). Campaigns already running keep their dates.</p>
      {error ? <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}
      {rows === null && !error ? <p className="mt-3 text-xs text-muted-foreground">Loading…</p> : null}
      {rows ? (
        <ul className="mt-3 divide-y divide-border/60">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {periodWord(r.days)} <span className="text-muted-foreground">· {r.name}</span>
                </span>
                <span className="block text-[11.5px] text-muted-foreground">{r.prices > 0 ? `${r.prices} price${r.prices === 1 ? "" : "s"} set` : "No price set yet, so it is not for sale anyway"}</span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={r.enabled}
                aria-label={`${periodWord(r.days)} campaigns ${r.enabled ? "on" : "off"}`}
                disabled={busy !== null}
                onClick={() => void toggle(r)}
                className={cn("relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60", r.enabled ? "bg-emerald-500" : "bg-muted")}
              >
                <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", r.enabled ? "left-[1.375rem]" : "left-0.5")} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
