"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The canonical PHYSICAL ad slots — who may occupy each location, in which
 * order (owner, 2026-10-08, shared-slot addendum §16/§60). Lives inside the
 * existing "Ad placements" tab, above the network rows it decides between:
 * one location, many possible providers, one served at a time. It never
 * creates a location — the registry (lib/ads-platform/slot-registry.ts) is the
 * inventory.
 */

type Provider = "frenzsave" | "network";

interface Slot {
  id: string;
  kind: "box" | "moment";
  location: string;
  component: string;
  newInventory: boolean;
  pages: string[] | null;
  aspect: { ratio: number; tolerance: number } | null;
  networkZone: string | null;
  networkActiveRows: number | null;
  paidPlacement: string | null;
  paidName: string | null;
  paidFormat: string | null;
  paidEnabled: boolean | null;
  paidLiveCampaigns: number | null;
  order: Provider[];
  defaultOrder: Provider[];
  customised: boolean;
}

const CHOICES: { key: string; label: string; order: Provider[] }[] = [
  { key: "frenzsave,network", label: "Paid campaign first, then network", order: ["frenzsave", "network"] },
  { key: "network,frenzsave", label: "Network first, then paid campaign", order: ["network", "frenzsave"] },
  { key: "frenzsave", label: "Paid campaigns only", order: ["frenzsave"] },
  { key: "network", label: "Network only", order: ["network"] },
];

function shape(s: Slot): string {
  if (s.kind === "moment") return "Full screen";
  if (!s.aspect) return "—";
  return s.aspect.ratio >= 5 ? "Banner, 10:1" : "Card, 320×200";
}

export function AdSlotsPanel() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/ads/slots")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { slots: Slot[] }) => alive && setSlots(d.slots))
      .catch(() => alive && setError("Couldn't load the slots."));
    return () => {
      alive = false;
    };
  }, []);

  const save = async (slot: Slot, order: Provider[]) => {
    setSaving(slot.id);
    setError(null);
    try {
      const r = await fetch("/api/admin/ads/slots", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slot: slot.id, order }) });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(d.error ?? "Couldn't save.");
      setSlots((all) => all?.map((x) => (x.id === slot.id ? { ...x, order, customised: true } : x)) ?? all);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-border bg-secondary/20 p-4">
      <p className="text-sm font-semibold">Ad slots — who may fill each location</p>
      <p className="mt-1 text-xs text-muted-foreground">
        One physical location, one ad at a time. Choose which provider gets each slot first; the next one fills it when the first has nothing. Changes reach visitors within 5 minutes.
      </p>
      {error ? <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p> : null}
      {!slots ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading slots…
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Slot</th>
                <th className="py-2 pr-3">Shape</th>
                <th className="py-2 pr-3">Network zone</th>
                <th className="py-2 pr-3">Paid placement</th>
                <th className="py-2 pr-3">Who fills it</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {slots.map((s) => {
                const allowed = CHOICES.filter((c) => c.order.every((p) => (p === "network" ? !!s.networkZone : !!s.paidPlacement)));
                const current = s.order.join(",");
                return (
                  <tr key={s.id} className="align-top">
                    <td className="py-2.5 pr-3">
                      <p className="font-mono text-[11.5px] font-semibold">{s.id}</p>
                      <p className="mt-0.5 max-w-[22rem] text-muted-foreground">{s.location}</p>
                      {s.newInventory ? <span className="mt-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200">New inventory</span> : null}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{shape(s)}</td>
                    <td className="py-2.5 pr-3">
                      {s.networkZone ? (
                        <>
                          <p className="font-mono text-[11.5px]">{s.networkZone}</p>
                          <p className={cn("mt-0.5", s.networkActiveRows ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>
                            {s.networkActiveRows ? `${s.networkActiveRows} active row${s.networkActiveRows === 1 ? "" : "s"}` : "No active row"}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {s.paidPlacement ? (
                        <>
                          <p>{s.paidName ?? s.paidPlacement}</p>
                          <p className={cn("mt-0.5", s.paidEnabled === false ? "text-rose-600" : "text-muted-foreground")}>
                            {s.paidEnabled === false ? "Placement off" : `${s.paidLiveCampaigns ?? 0} live campaign${s.paidLiveCampaigns === 1 ? "" : "s"}`}
                          </p>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <select
                        value={allowed.some((c) => c.key === current) ? current : allowed[0]?.key}
                        disabled={saving === s.id || allowed.length < 2}
                        onChange={(e) => {
                          const c = allowed.find((x) => x.key === e.target.value);
                          if (c) void save(s, c.order);
                        }}
                        aria-label={`Who fills ${s.id}`}
                        className="h-9 rounded-lg border border-border bg-background px-2 text-xs"
                      >
                        {allowed.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      {saving === s.id ? <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" /> : s.customised ? <span className="ml-2 text-[10px] text-muted-foreground">custom</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
