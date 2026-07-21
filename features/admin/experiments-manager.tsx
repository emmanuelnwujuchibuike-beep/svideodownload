"use client";

import { FlaskConical, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn, formatCompactNumber } from "@/lib/utils";

interface Variant {
  id: string;
  weight: number;
}

/** Mirrors the GET /api/admin/experiments payload. */
export interface AdminExperiment {
  id: string;
  label: string;
  description: string;
  status: "draft" | "running" | "concluded";
  variants: Variant[];
  plans: string[] | null;
  override: { paused: boolean | null; forceVariant: string | null };
  exposures: Record<string, number>;
}

const STATUS_STYLE: Record<AdminExperiment["status"], string> = {
  running: "bg-green-500/15 text-green-500",
  draft: "bg-secondary text-muted-foreground",
  concluded: "bg-primary/10 text-primary",
};

export function ExperimentsManager({ experiments }: { experiments: AdminExperiment[] }) {
  if (experiments.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        No experiments declared. Add one to{" "}
        <code className="font-mono">lib/platform/experiments.ts</code> and it appears here.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {experiments.map((e) => (
        <ExperimentRow key={e.id} experiment={e} />
      ))}
    </div>
  );
}

function ExperimentRow({ experiment: e }: { experiment: AdminExperiment }) {
  const router = useRouter();
  const [paused, setPaused] = useState(e.override.paused === true);
  const [forceVariant, setForceVariant] = useState(e.override.forceVariant ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const totalExposures = Object.values(e.exposures).reduce((s, n) => s + n, 0);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/experiments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: e.id,
          paused,
          forceVariant: forceVariant === "" ? null : forceVariant,
        }),
      });
      const json = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: "Saved — live within ~10s across all instances." }
          : { ok: false, text: json.error ?? "Failed to save." },
      );
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-border bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold">
            <FlaskConical className="h-4 w-4 text-primary" /> {e.label}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                STATUS_STYLE[e.status],
              )}
            >
              {e.status}
            </span>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
          <p className="mt-2 text-xs text-muted-foreground/80">
            <span className="font-mono">{e.id}</span>
            {e.plans ? ` · plans: ${e.plans.join(", ")}` : ""} ·{" "}
            {formatCompactNumber(totalExposures)} exposures
          </p>
        </div>
      </div>

      {/* Arms: declared weight + live exposure share. */}
      <div className="mt-4 space-y-2.5 border-t border-border/60 pt-4">
        {e.variants.map((v) => {
          const count = e.exposures[v.id] ?? 0;
          const share = totalExposures > 0 ? Math.round((count / totalExposures) * 100) : 0;
          const isControl = e.variants[0]?.id === v.id;
          return (
            <div key={v.id}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium">
                  {v.id}
                  {isControl ? (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      control
                    </span>
                  ) : null}
                  <span className="text-xs font-normal text-muted-foreground">
                    weight {v.weight}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {formatCompactNumber(count)} · {share}%
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-600"
                  style={{ width: `${Math.max(2, share)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Runtime controls. */}
      <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border/60 pt-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={paused}
            onChange={(ev) => setPaused(ev.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span>Pause (everyone → control)</span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Force variant</span>
          <select
            value={forceVariant}
            onChange={(ev) => setForceVariant(ev.target.value)}
            className="h-9 rounded-lg bg-background px-2 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
          >
            <option value="">— none —</option>
            {e.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </button>
        {msg ? (
          <span className={cn("w-full text-sm sm:w-auto", msg.ok ? "text-green-500" : "text-red-400")}>
            {msg.text}
          </span>
        ) : null}
      </div>
    </section>
  );
}
