"use client";

import { useState } from "react";

import type { CharacterReplaceAdminJob } from "@/lib/ai/admin-stats";
import { cn } from "@/lib/utils";

/**
 * The operator's recovery actions for one Character Replace job (Part 5, §35).
 *
 * Each button asks for confirmation AND a reason before it posts; the route
 * records `admin.<action>` with the operator's id before anything moves, and
 * the "Events" toggle reads the job's audit trail back so the operator can
 * see what the background did — and what they just did.
 *
 * No timers, no polling (an SSE/interval in features/admin bills compute
 * continuously — see the memory rule); every read is a click.
 */
type Action = "retry_finalization" | "reconcile" | "retry_notification" | "refund";

const LABEL: Record<Action, string> = {
  retry_finalization: "Retry finalization",
  reconcile: "Reconcile now",
  retry_notification: "Resend notification",
  refund: "Refund",
};

function available(job: CharacterReplaceAdminJob): Action[] {
  const active = job.status === "queued" || job.status === "acquiring" || job.status === "processing" || job.status === "finalizing";
  const out: Action[] = [];
  if ((job.status === "processing" || job.status === "finalizing") && (job.finalizeAttempts > 0 || job.stuck || job.status === "finalizing")) out.push("retry_finalization");
  if ((job.status === "queued" || job.status === "processing") && job.predictionId) out.push("reconcile");
  if (!active && job.userId) out.push("retry_notification");
  if ((job.status === "failed" || job.status === "cancelled" || job.status === "expired") && (job.chargedCents ?? 0) > 0 && !job.refunded) out.push("refund");
  return out;
}

export function CharacterReplaceJobActions({ job }: { job: CharacterReplaceAdminJob }) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [events, setEvents] = useState<{ id: number; at: string; kind: string; actor: string; detail: Record<string, unknown> }[] | null>(null);
  const actions = available(job);

  const run = async (action: Action) => {
    const reason = window.prompt(`${LABEL[action]} for job ${job.id.slice(0, 8)} — why? (recorded in the audit log)`);
    if (!reason || reason.trim().length < 3) return;
    if (!window.confirm(`${LABEL[action]} on ${job.id.slice(0, 8)}?\n\nReason: ${reason.trim()}`)) return;
    setBusy(action);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/ai/character-replace/jobs/${job.id}/recover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; detail?: string; error?: string };
      setNote(res.ok ? { ok: body.ok !== false, text: body.detail ?? "Done." } : { ok: false, text: body.error ?? `HTTP ${res.status}` });
      if (events) await loadEvents();
    } catch (e) {
      setNote({ ok: false, text: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const loadEvents = async () => {
    const res = await fetch(`/api/admin/ai/character-replace/jobs/${job.id}/recover`);
    const body = (await res.json().catch(() => ({}))) as { events?: typeof events };
    setEvents(body.events ?? []);
  };

  return (
    <div className="min-w-[11rem]">
      <div className="flex flex-wrap gap-1">
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            disabled={busy !== null}
            onClick={() => void run(a)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-semibold transition disabled:opacity-50",
              a === "refund" ? "border-amber-500/40 text-amber-700 hover:bg-amber-500/10" : "border-border/70 hover:bg-secondary",
            )}
          >
            {busy === a ? "…" : LABEL[a]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => (events ? setEvents(null) : void loadEvents())}
          className="rounded-full border border-transparent px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-secondary"
        >
          {events ? "Hide events" : "Events"}
        </button>
      </div>
      {note ? <p className={cn("mt-1 text-[11px]", note.ok ? "text-emerald-600" : "text-rose-600")}>{note.text}</p> : null}
      {events ? (
        <ol className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-xl bg-secondary/50 p-2 font-mono text-[10.5px] leading-snug">
          {events.length === 0 ? <li className="text-muted-foreground">No events recorded yet.</li> : null}
          {events.map((e) => (
            <li key={e.id} className="break-all">
              <span className="text-muted-foreground">{new Date(e.at).toLocaleTimeString()}</span> <span className="font-semibold">{e.kind}</span>
              {e.actor !== "system" ? <span className="text-amber-700"> {e.actor}</span> : null}{" "}
              <span className="text-muted-foreground">{JSON.stringify(e.detail)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
