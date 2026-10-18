"use client";

import { useState } from "react";
import { profilePath } from "@/lib/social/profile-url";

/**
 * Admin → Moderation → Trust signals (Feature 19 · Part 16). Accounts that look
 * like spam, automation or repeat abuse, each flag saying what was seen. Loaded
 * on the button, never polled; nothing here acts on an account by itself.
 */
export function TrustSignals() {
  const [rows, setRows] = useState<{ userId: string; handle: string | null; flags: { kind: string; why: string }[] }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    const r = await fetch("/api/admin/trust-signals").then((x) => (x.ok ? x.json() : { flags: [] })).catch(() => ({ flags: [] }));
    setRows(r.flags);
    setBusy(false);
  };
  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="font-semibold">Trust signals</h2>
      <p className="mt-1 text-xs text-muted-foreground">Mass friend requests or follows in 24 hours, repeat upheld reports in 30 days, and very new accounts among them. Signals for review; nothing happens automatically.</p>
      <button type="button" onClick={() => void load()} disabled={busy} className="btn-lux mt-3 bg-foreground text-background">
        {busy ? "Checking…" : rows ? "Check again" : "Check now"}
      </button>
      {rows ? (
        rows.length ? (
          <ul className="mt-3 divide-y divide-border/60 rounded-2xl border border-border/70 text-sm">
            {rows.map((r) => (
              <li key={r.userId} className="px-3 py-2">
                <a href={r.handle ? `${profilePath(r.handle)}` : "#"} className="font-semibold">
                  {r.handle ? `@${r.handle}` : r.userId.slice(0, 8)}
                </a>
                <span className="block text-xs text-muted-foreground">{r.flags.map((f) => f.why).join(" · ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nothing unusual right now.</p>
        )
      ) : null}
    </section>
  );
}
