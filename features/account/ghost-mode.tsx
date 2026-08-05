"use client";

import { Ghost, Info, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";

import {
  GHOST_SIGNALS,
  allSignals,
  ghostedCount,
  isFullyGhosted,
  reciprocalSignals,
  writesFor,
  type GhostSignalKey,
  type GhostState,
} from "@/lib/privacy/ghost";
import { cn } from "@/lib/utils";

/**
 * Ghost Mode™ (Part 19).
 *
 * ── Writes go to the EXISTING endpoints ──────────────────────────────────
 * `/api/privacy` and `/api/presence-status` already own these settings, and
 * both already validate them. Adding a third endpoint that wrote the same
 * columns would mean two places to keep a privacy rule correct, which is how
 * one of them ends up wrong.
 *
 * The two stores are written SEPARATELY and the UI reverts precisely what
 * failed. A single "ghost" request that half-succeeded would leave a member
 * believing they were invisible while their online dot was still green — the
 * one failure this screen exists to prevent.
 *
 * ── Reciprocity is stated before the switch, not after ───────────────────
 * Hiding read receipts, typing and last seen also hides other people's from
 * you. That is the convention everywhere, but discovering it afterwards reads
 * as a bug, so it is on screen before anything is tapped.
 */
export function GhostModePanel({ initial }: { initial: GhostState }) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    async (target: Partial<GhostState>, key: string) => {
      const previous = state;
      const next = { ...state, ...target };
      const writes = writesFor(target, state);

      setState(next);
      setBusy(key);
      setError(null);

      const failures: string[] = [];
      // Sequential, not parallel: two privacy writes racing on the same row is
      // a last-write-wins bug waiting to happen, and there are at most two.
      if (Object.keys(writes.privacy).length > 0) {
        try {
          const res = await fetch("/api/privacy", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(writes.privacy),
          });
          if (!res.ok) failures.push("privacy");
        } catch {
          failures.push("privacy");
        }
      }
      if (writes.presence) {
        try {
          // PATCH, not POST. The route exports PATCH only, so a POST was a
          // 405 that this code dutifully reported as a failure and reverted —
          // which is why the online-status switch would not stay on.
          const res = await fetch("/api/presence-status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: writes.presence }),
          });
          if (!res.ok) failures.push("presence");
        } catch {
          failures.push("presence");
        }
      }

      if (failures.length > 0) {
        // Revert only what failed, so a partial success is reported honestly
        // rather than rolled back wholesale.
        setState((current) => {
          const fixed = { ...current };
          for (const s of GHOST_SIGNALS) {
            const store = s.source === "user_presence_status" ? "presence" : "privacy";
            if (failures.includes(store)) fixed[s.key] = previous[s.key];
          }
          return fixed;
        });
        setError(
          failures.includes("privacy") && failures.includes("presence")
            ? "Couldn't save. Check your connection and try again."
            : `Saved, except your ${failures[0] === "presence" ? "online status" : "privacy settings"}. Try again.`,
        );
      }
      setBusy(null);
    },
    [state],
  );

  const all = isFullyGhosted(state);
  const count = ghostedCount(state);

  return (
    <div className="space-y-5">
      <div
        className={cn(
          "rounded-2xl border px-4 py-4 shadow-sm transition",
          all ? "border-violet-500/30 bg-violet-500/[0.06]" : "border-border/70 bg-card",
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              all ? "bg-violet-500/15 text-violet-500" : "bg-secondary text-muted-foreground",
            )}
          >
            <Ghost className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">Ghost Mode</p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {all
                ? "Every activity signal below is hidden."
                : count === 0
                  ? "You're visible in the normal way."
                  : `${count} of ${GHOST_SIGNALS.length} signals hidden.`}
            </p>
          </div>
          <Switch
            checked={all}
            busy={busy === "all"}
            label="Ghost Mode"
            onChange={() => void apply(allSignals(!all), "all")}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        {GHOST_SIGNALS.map((s) => (
          <div key={s.key} className="flex items-center gap-3 border-b border-border/60 px-3.5 py-3 last:border-0">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{s.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{s.blurb}</span>
            </span>
            <Switch
              checked={state[s.key]}
              busy={busy === s.key}
              label={`Hide ${s.label}`}
              onChange={() => void apply({ [s.key]: !state[s.key] } as Partial<GhostState>, s.key)}
            />
          </div>
        ))}
      </div>

      <p className="flex items-start gap-2 rounded-2xl bg-secondary/40 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Hiding {listNames(reciprocalSignals().map((s) => s.label))} also hides other people&apos;s from you. That is
          how these work everywhere, and it is worth knowing before you switch them off rather than after.
        </span>
      </p>

      {error ? <p className="text-xs font-medium text-rose-500">{error}</p> : null}
    </div>
  );
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0]?.toLowerCase() ?? "";
  const lower = names.map((n) => n.toLowerCase());
  return `${lower.slice(0, -1).join(", ")} and ${lower.at(-1)}`;
}

function Switch({
  checked,
  busy,
  label,
  onChange,
}: {
  checked: boolean;
  busy: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={busy}
      onClick={onChange}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60",
        checked ? "bg-violet-500" : "bg-secondary ring-1 ring-inset ring-border",
      )}
    >
      {busy ? (
        <Loader2 className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />
      ) : (
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      )}
    </button>
  );
}

export type { GhostSignalKey };
