"use client";

import { useState } from "react";

import type { KlingStatus } from "@/lib/ai/kling/account";
import { cn } from "@/lib/utils";

const VERDICT: Record<KlingStatus["connection"], { ok: boolean; text: string }> = {
  ok: { ok: true, text: "Connected — the key is accepted." },
  bad_key: { ok: false, text: "Kling refused the key. Check KLING_API_KEY on Vercel and Railway." },
  unreachable: { ok: false, text: "Kling did not answer. Try again in a minute." },
  unknown: { ok: false, text: "Kling answered in a way we do not recognise." },
  not_configured: { ok: false, text: "No Kling key is set on this deployment." },
};

const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");

/**
 * Admin → Kling pricing → "Kling connection" (Part 8 §46 / §8). One tap tests
 * the key and reads the units left per pack — no task is created, nothing is
 * billed, and nothing loads until the tap (no polling: an admin tab left open
 * costs nothing).
 */
export function KlingConnectionCard() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<KlingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai/kling/status", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 403 ? "Admins only." : `The check failed (${res.status}).`);
      setStatus((await res.json()) as KlingStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The check failed.");
    } finally {
      setBusy(false);
    }
  };

  const verdict = status ? VERDICT[status.connection] : null;
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mb-1 font-semibold">Kling connection</h2>
          <p className="text-sm text-muted-foreground">Tests the key and shows the units left. Free — it never starts a video.</p>
        </div>
        <button
          type="button"
          onClick={check}
          disabled={busy}
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
        >
          {busy ? "Checking…" : status ? "Check again" : "Test connection"}
        </button>
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}

      {status && verdict && (
        <div className="space-y-4">
          <p className={cn("text-sm font-medium", verdict.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500")}>{verdict.text}</p>

          {status.configured && (
            <div>
              <p className="text-sm">
                Units left:{" "}
                <span className={cn("font-semibold", status.remainingUnits !== null && status.remainingUnits < 20 && "text-rose-500")}>
                  {status.remainingUnits === null ? "could not be read" : status.remainingUnits}
                </span>
                {status.remainingUnits !== null && status.remainingUnits < 20 && <span className="text-rose-500"> — low: videos will fail when this reaches 0</span>}
              </p>
              {status.packs.length + status.spentPacks.length > 0 && (
                <ul className="mt-3 divide-y divide-border rounded-2xl border border-border text-sm">
                  {[...status.packs, ...status.spentPacks].map((p, i) => {
                    const live = i < status.packs.length;
                    return (
                      <li key={i} className={cn("flex flex-wrap items-center justify-between gap-2 px-3 py-2", !live && "text-muted-foreground")}>
                        <span>{p.name}</span>
                        <span className="tabular-nums">
                          {p.remaining} / {p.total} · {live ? `until ${day(p.expiresAt)}` : p.remaining <= 0 ? "used up" : "expired"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {status.lastError && <p className="text-sm text-rose-500">Last error: {status.lastError}</p>}
          <p className="text-xs text-muted-foreground">
            {status.host ? `${status.host} · ` : ""}
            {status.authMode === "api_key" ? "API key" : status.authMode === "jwt" ? "Access key + secret" : "no credential"} · checked {new Date(status.checkedAt).toLocaleTimeString()}
          </p>
        </div>
      )}
    </section>
  );
}
