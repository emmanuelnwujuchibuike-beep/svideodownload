"use client";

import { AlertCircle, Loader2, Radio } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  REWARD_NETWORK_DEFS,
  REWARD_SURFACES,
  networkDef,
  type RewardNetwork,
  type RewardNetworkMap,
  type RewardSurface,
} from "@/lib/monetization/reward-networks";
import { cn } from "@/lib/utils";

/**
 * Admin → which ad network pays for which reward moment (owner, 2026-08-25:
 * "I want to be able to decide in admin dashboard which reward ad network for
 * a particular feature").
 *
 * ── One row per moment, not per network ───────────────────────────────────
 * The question an operator is actually asking is "what pays for THIS gate",
 * so the moment is the row and the network is the choice. The inverse layout
 * (a network with a list of surfaces) reads better in a brochure and is
 * useless here — it makes "what does the multi-link gate run?" a search
 * instead of a glance.
 *
 * ── Unavailable networks are shown, disabled, WITH the reason ─────────────
 * Offerium is listed and greyed rather than hidden. Hiding it would leave an
 * operator who was promised it wondering whether it exists; showing it as a
 * live option would be a control that silently falls back. The specific
 * blocker is printed next to it, the same way `offeriumReadiness()` names the
 * missing credential rather than saying "not configured".
 */
export function RewardNetworkEditor({
  settings,
  /** From `offeriumConfigured()` on the server — credentials AND env secrets. */
  offeriumConfigured,
}: {
  settings: RewardNetworkMap;
  offeriumConfigured: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<RewardNetworkMap>(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setNetwork = (surface: RewardSurface, network: RewardNetwork) =>
    setState((s) => ({
      ...s,
      // Clearing the GPT path when moving off GPT keeps the saved row honest —
      // the API refuses a path on a non-GPT surface, and silently keeping dead
      // config would make that refusal look arbitrary.
      [surface]: {
        network,
        gptAdUnitPath: network === "gpt_rewarded" ? s[surface].gptAdUnitPath : "",
      },
    }));

  const setPath = (surface: RewardSurface, gptAdUnitPath: string) =>
    setState((s) => ({ ...s, [surface]: { ...s[surface], gptAdUnitPath } }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/reward-networks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const json = await res.json();
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: json.error ?? "Failed." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Radio className="h-5 w-5 text-primary" /> Reward ad network per feature
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Each moment below can run a different network. Changing one never affects another — the
        multi-link gate can run a Google rewarded ad while wallpaper downloads run an interstitial.
      </p>

      <div className="space-y-2.5">
        {REWARD_SURFACES.map((def) => {
          const chosen = state[def.id];
          return (
            <div key={def.id} className="rounded-2xl border border-border/70 bg-background/50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{def.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{def.description}</p>
                </div>
                <label className="sr-only" htmlFor={`net-${def.id}`}>
                  Network for {def.label}
                </label>
                <select
                  id={`net-${def.id}`}
                  value={chosen.network}
                  onChange={(e) => setNetwork(def.id, e.target.value as RewardNetwork)}
                  className="h-10 min-w-[13rem] rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                >
                  {REWARD_NETWORK_DEFS.filter((n) => def.supports.includes(n.id)).map((n) => {
                    // Offerium becomes selectable the moment its integration
                    // lands; until then `available` is what disables it.
                    const usable = n.available && (n.id !== "offerium" || offeriumConfigured);
                    return (
                      <option key={n.id} value={n.id} disabled={!usable && chosen.network !== n.id}>
                        {n.label}
                        {n.available ? "" : " — not available yet"}
                      </option>
                    );
                  })}
                </select>
              </div>

              {def.note ? (
                <p className="mt-2 text-xs text-muted-foreground/90">{def.note}</p>
              ) : null}

              {chosen.network === "gpt_rewarded" ? (
                <div className="mt-2.5">
                  <label
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                    htmlFor={`gpt-${def.id}`}
                  >
                    Google ad unit path for this moment (optional)
                  </label>
                  <input
                    id={`gpt-${def.id}`}
                    type="text"
                    placeholder="/1234567/rewarded_multilink"
                    value={chosen.gptAdUnitPath}
                    onChange={(e) => setPath(def.id, e.target.value)}
                    className="h-10 w-full rounded-xl bg-background px-3 font-mono text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Leave empty to use the site-wide default. A separate unit per moment is the only
                    way a Google report can tell this gate&apos;s revenue from another&apos;s.
                  </p>
                </div>
              ) : null}

              {chosen.network === "offerium" ? (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                  <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
                  {networkDef("offerium").unavailableReason} Until then this moment falls back to{" "}
                  {networkDef(def.fallback).label}.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save routing
        </button>
        {msg ? (
          <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Premium members skip every reward moment regardless of what is selected here — that is what
        they are paying for, and no routing choice can override it.
      </p>
    </section>
  );
}
