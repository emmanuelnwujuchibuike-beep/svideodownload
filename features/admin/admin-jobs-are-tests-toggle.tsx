"use client";

import { useState } from "react";

/**
 * The one live setting left on Admin → AI → Providers: whether an admin's own
 * jobs are recorded as tests (kept out of revenue and usage figures). Saved
 * through the same admin route as every other setting, which now accepts
 * nothing else under `frenzAiProviders`.
 */
export function AdminJobsAreTestsToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(next: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/landing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ frenzAiProviders: { adminJobsAreTests: next } }),
      });
      if (res.ok) {
        setOn(next);
        setMsg({ ok: true, text: "Saved." });
      } else {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg({ ok: false, text: json.error ?? "Couldn't save." });
      }
    } catch {
      setMsg({ ok: false, text: "Couldn't save — check the connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold">Admin jobs are tests</p>
        <p className="text-xs text-muted-foreground">Your own generations are marked as tests and kept out of revenue and usage figures.</p>
      </div>
      <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={on} disabled={busy} onChange={(e) => void save(e.target.checked)} />
        {on ? "On" : "Off"}
      </label>
      {msg ? <p className={msg.ok ? "w-full text-xs text-emerald-700 dark:text-emerald-400" : "w-full text-xs text-rose-700 dark:text-rose-400"} role="status">{msg.text}</p> : null}
    </section>
  );
}
