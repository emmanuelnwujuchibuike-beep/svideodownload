"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** "Close now" for one model's circuit — asks why, records it, refreshes the table. */
export function CharacterReplaceCircuitClose({ providerKey }: { providerKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = async () => {
    const reason = window.prompt(`Close the circuit for ${providerKey} — why? (recorded in the audit log)`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/ai/character-replace/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close", key: providerKey, reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; detail?: string; error?: string };
      setNote(res.ok ? (body.detail ?? "Done.") : (body.error ?? `HTTP ${res.status}`));
      if (res.ok) router.refresh();
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" disabled={busy} onClick={run} className="rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold transition hover:bg-secondary disabled:opacity-50">
        {busy ? "Closing…" : "Close now"}
      </button>
      {note ? <span className="text-[10.5px] text-muted-foreground">{note}</span> : null}
    </span>
  );
}
