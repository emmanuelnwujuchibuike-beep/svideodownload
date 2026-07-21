"use client";

import { Loader2, Megaphone } from "lucide-react";
import { useState } from "react";

import type { Broadcast, BroadcastTargetPlan } from "@/lib/social/broadcasts";
import { cn } from "@/lib/utils";

const TARGETS: { value: BroadcastTargetPlan; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "free", label: "Free plan" },
  { value: "pro", label: "Pro plan" },
  { value: "business", label: "Business plan" },
];

/** Admin broadcast alerts (Part 4) — plan-tier targeting, real fan-out via the existing notifications + Web Push pipeline. */
export function BroadcastComposer({ initialBroadcasts }: { initialBroadcasts: Broadcast[] }) {
  const [history, setHistory] = useState(initialBroadcasts);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<BroadcastTargetPlan>("all");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    if (!title.trim() || !body.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), targetPlan: target }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Failed." });
        return;
      }
      setMsg({ ok: true, text: `Sent to ${json.sent} users.` });
      setTitle("");
      setBody("");
      const fresh = await fetch("/api/admin/broadcast").then((r) => (r.ok ? r.json() : null));
      if (fresh?.broadcasts) setHistory(fresh.broadcasts);
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const input = "w-full rounded-xl bg-background px-3 py-2.5 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary";
  const label = "mb-1 block text-xs font-medium text-muted-foreground";

  return (
    <section className="mt-6 rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Megaphone className="h-5 w-5 text-primary" /> Broadcast alert
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Sends immediately to every matching, non-suspended user — one Notification Center entry + a real push, styled distinctly from a personal
        notification.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Title</label>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value.slice(0, 120))} placeholder="Scheduled maintenance tonight" />
        </div>
        <div>
          <label className={label}>Target</label>
          <select className={input} value={target} onChange={(e) => setTarget(e.target.value as BroadcastTargetPlan)}>
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3">
        <label className={label}>Message</label>
        <textarea
          className={cn(input, "min-h-20 resize-none")}
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 500))}
          placeholder="Frenz will be briefly unavailable at 2am UTC for an upgrade."
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={busy || !title.trim() || !body.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Send now
        </button>
        {msg ? <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
      </div>

      {history.length > 0 ? (
        <ul className="mt-5 divide-y divide-border/60 border-t border-border/60 pt-3">
          {history.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium">{b.title}</span> <span className="text-muted-foreground">· {b.targetPlan}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {b.sentCount} sent · {new Date(b.createdAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
