import type { ProviderHealth } from "@/lib/ai/character-replace/circuit";
import type { ConfigChange } from "@/lib/platform/config-audit";

import { CharacterReplaceCircuitClose } from "./character-replace-providers-actions";

/**
 * Admin → AI → Character Replace → Providers & changes (Part 8 §7, §21, §22).
 *
 * Server component: two lists the operator reads and one small client button.
 *   · every provider model's circuit state — failures in the window, whether
 *     it is paused and until when, the last error line, how often it opened;
 *   · the last settings changes to Character Replace, from the platform's
 *     config audit log — who, when, which keys, their reason.
 *
 * Model names appear here and nowhere a member can see; this page is behind
 * the admin guard.
 */
export function CharacterReplaceProvidersPanel({ providers, changes, now = Date.now() }: { providers: ProviderHealth[]; changes: ConfigChange[]; now?: number }) {
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 font-semibold">Providers</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        The circuit breaker&apos;s memory: one row per model. A paused model refuses new starts (nothing charged) and makes paid jobs wait until the pause passes. The
        thresholds live under Character Replace pricing → Switches, limits &amp; safety.
      </p>
      {providers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">No provider has been called since the breaker was added.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Model</th>
                <th className="py-2 pr-3">State</th>
                <th className="py-2 pr-3">Window</th>
                <th className="py-2 pr-3">Last success</th>
                <th className="py-2 pr-3">Last failure</th>
                <th className="py-2 pr-3">Opened</th>
                <th className="py-2 pr-3">Last error</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {providers.map((p) => {
                const until = p.openedUntil ? Date.parse(p.openedUntil) : NaN;
                const open = Number.isFinite(until) && until > now;
                return (
                  <tr key={p.key} className="align-top">
                    <td className="py-2 pr-3 font-mono text-[11px]">{p.key}</td>
                    <td className="py-2 pr-3">
                      <span className={open ? "rounded-full bg-rose-500/15 px-2 py-0.5 font-semibold text-rose-600 dark:text-rose-300" : "rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300"}>
                        {open ? `Paused until ${new Date(until).toLocaleTimeString()}` : "Closed"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {p.failures} failed · {p.successes} ok
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{p.lastSuccess ? new Date(p.lastSuccess).toLocaleString() : "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">{p.lastFailure ? new Date(p.lastFailure).toLocaleString() : "—"}</td>
                    <td className="py-2 pr-3 tabular-nums">{p.openedCount}×</td>
                    <td className="max-w-[20rem] py-2 pr-3 text-muted-foreground">{p.lastError ?? "—"}</td>
                    <td className="py-2">{open || p.failures > 0 ? <CharacterReplaceCircuitClose providerKey={p.key} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mb-1 mt-8 font-semibold">Recent settings changes</h3>
      <p className="mb-3 text-sm text-muted-foreground">Every Character Replace settings save and every hand-closed circuit, newest first — the admin, the moment, the keys that changed and the reason given.</p>
      {changes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">No changes recorded yet.</p>
      ) : (
        <ol className="divide-y divide-border/60 text-xs">
          {changes.map((c) => {
            const after = (c.after ?? {}) as Record<string, unknown>;
            const reason = typeof after._reason === "string" ? after._reason : null;
            const keys = Object.keys(after).filter((k) => k !== "_reason");
            return (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="tabular-nums text-muted-foreground">{new Date(c.at).toLocaleString()}</span>
                <span className="font-semibold">{c.action === "circuit.close" ? `Closed ${c.targetId.replace(/^provider:/, "")}` : keys.length > 0 ? keys.join(", ") : c.action}</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">{c.actorId ? c.actorId.slice(0, 8) : "system"}</span>
                {reason ? <span className="text-muted-foreground">— {reason}</span> : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
