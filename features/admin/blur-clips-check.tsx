"use client";

import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

type Row = { ok: boolean; step: string; detail: string };

/**
 * Admin → Private posts → "Make missing blurred clips" (2026-10-30): starts the worker's blurred-clip job and shows each
 * link of the chain — this server's worker address and secret, the worker's answer, its storage, private bucket and
 * ffmpeg, its last run — stopping at the first that is broken (app/api/admin/sub/blur-clips).
 */
export function BlurClipsCheck() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const res = await fetch("/api/admin/sub/blur-clips", { method: "POST" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { checks?: Row[] } | null;
    setRows(j?.checks ?? [{ ok: false, step: "Check", detail: "Couldn't reach this server." }]);
    setBusy(false);
  };
  return (
    <div className="mt-4 rounded-2xl border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Blurred previews</p>
          <p className="text-xs text-muted-foreground">Locked videos autoplay blurred once the worker has made their clip.</p>
        </div>
        <button type="button" onClick={() => void run()} disabled={busy} className="h-9 shrink-0 rounded-xl bg-foreground px-3 text-xs font-semibold text-background disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Make missing clips"}
        </button>
      </div>
      {rows ? (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.step} className="flex gap-2 text-xs">
              {r.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" />}
              <span>
                <span className={cn("font-semibold", !r.ok && "text-rose-600")}>{r.step}</span> — <span className="break-all text-muted-foreground">{r.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
