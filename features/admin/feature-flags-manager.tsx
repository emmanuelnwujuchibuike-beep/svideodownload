"use client";

import { Flag, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { cn } from "@/lib/utils";

/** Mirrors the GET /api/admin/flags payload. */
export interface AdminFlag {
  id: string;
  label: string;
  description: string;
  category: string;
  defaultEnabled: boolean;
  rollout: number | null;
  plans: string[] | null;
  adminBypass: boolean;
  consumer: string;
  override: { enabled: boolean | null; rolloutPercentage: number | null };
}

type Mode = "auto" | "on" | "off";

function modeOf(enabled: boolean | null): Mode {
  if (enabled === true) return "on";
  if (enabled === false) return "off";
  return "auto";
}

/**
 * The feature-flag operator surface. Lists every code-declared flag and edits its
 * override — the manual switch (On / Off / Auto) and, in Auto, the rollout %.
 *
 * "Auto" means: no manual override — the flag follows its declared rollout/default
 * and any percentage set here. "On"/"Off" are a force / kill switch that win over
 * the rollout. This is the whole editable surface of `feature_flags`; the flags
 * themselves are declared in code (`lib/platform/flags.ts`).
 */
export function FeatureFlagManager({ flags }: { flags: AdminFlag[] }) {
  if (flags.length === 0) {
    return (
      <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        No flags declared yet. Add one to <code className="font-mono">lib/platform/flags.ts</code>{" "}
        and it appears here automatically.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {flags.map((f) => (
        <FlagRow key={f.id} flag={f} />
      ))}
    </div>
  );
}

function FlagRow({ flag }: { flag: AdminFlag }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(modeOf(flag.override.enabled));
  const [pct, setPct] = useState<string>(
    flag.override.rolloutPercentage != null
      ? String(flag.override.rolloutPercentage)
      : flag.rollout != null
        ? String(flag.rollout)
        : "",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const rolloutPercentage =
      mode === "auto" && pct.trim() !== "" ? Math.max(0, Math.min(100, Number(pct))) : null;
    try {
      const res = await fetch("/api/admin/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: flag.id,
          enabled: mode === "on" ? true : mode === "off" ? false : null,
          rolloutPercentage,
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
            <Flag className="h-4 w-4 text-primary" /> {flag.label}
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {flag.category}
            </span>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{flag.description}</p>
          <p className="mt-2 text-xs text-muted-foreground/80">
            <span className="font-mono">{flag.id}</span> · default{" "}
            {flag.defaultEnabled ? "on" : "off"}
            {flag.plans ? ` · plans: ${flag.plans.join(", ")}` : ""}
            {flag.adminBypass ? " · admin preview" : ""} · consumer: {flag.consumer}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {(["off", "auto", "on"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
                mode === m
                  ? m === "on"
                    ? "bg-green-500/15 text-green-500 ring-1 ring-green-500/40"
                    : m === "off"
                      ? "bg-red-500/15 text-red-500 ring-1 ring-red-500/40"
                      : "bg-primary/10 text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:bg-secondary",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
        <label
          className={cn(
            "flex items-center gap-2 text-sm",
            mode !== "auto" && "opacity-40",
          )}
        >
          <span className="text-muted-foreground">Rollout</span>
          <input
            type="number"
            min={0}
            max={100}
            value={pct}
            disabled={mode !== "auto"}
            placeholder={flag.defaultEnabled ? "100" : "0"}
            onChange={(e) => setPct(e.target.value)}
            className="h-9 w-20 rounded-lg bg-background px-2 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary disabled:cursor-not-allowed"
          />
          <span className="text-muted-foreground">%</span>
        </label>
        <span className="text-xs text-muted-foreground">
          {mode === "on"
            ? "Forced ON for everyone (past any rollout)."
            : mode === "off"
              ? "Kill switch — OFF for everyone."
              : "Follows the rollout % above (deterministic per user)."}
        </span>

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
