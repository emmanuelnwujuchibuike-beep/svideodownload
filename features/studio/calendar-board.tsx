"use client";

import { CalendarPlus, Check, Loader2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { toast } from "@/features/ui/toast";
import { PLAN_KIND_LABEL, PLAN_KINDS, type PlanEntry, type PlanKind, type ScheduledPost } from "@/lib/creator/plan-kinds";
import { cn } from "@/lib/utils";

/**
 * The content calendar (Feature 15 · Part 9).
 *
 * Two REAL row types and no third: scheduled posts (`posts.scheduled_at`) and
 * plans (`content_plan`). A month grid, rendered from data the page fetched.
 *
 * ── Rescheduling is an explicit date change, not a drag ─────────────────
 * Drag-and-drop across a month grid fights the scroll on a phone and is
 * unusable with a keyboard or a screen reader. Picking a date works identically
 * for everyone, and it is also the only interaction that can be confirmed.
 */

const KIND_TONE: Record<PlanKind, string> = {
  idea: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  campaign: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  event: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  launch: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  collab: "bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300",
  seasonal: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
};

function iso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function CalendarBoard({
  year,
  month,
  plans,
  scheduled,
  published,
}: {
  year: number;
  /** 0-indexed, as JavaScript months are. */
  month: number;
  plans: PlanEntry[];
  scheduled: ScheduledPost[];
  published: ScheduledPost[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first, which is how a publishing week is usually planned.
  const leading = (first.getDay() + 6) % 7;
  const today = iso(new Date());

  const byDay = new Map<string, { plans: PlanEntry[]; scheduled: ScheduledPost[]; published: ScheduledPost[] }>();
  const bucket = (key: string) => {
    let b = byDay.get(key);
    if (!b) {
      b = { plans: [], scheduled: [], published: [] };
      byDay.set(key, b);
    }
    return b;
  };
  for (const p of plans) bucket(p.plannedFor).plans.push(p);
  for (const s of scheduled) if (s.scheduledAt) bucket(s.scheduledAt.slice(0, 10)).scheduled.push(s);
  for (const p of published) if (p.scheduledAt) bucket(p.scheduledAt.slice(0, 10)).published.push(p);

  const createPlan = async (date: string, title: string, kind: PlanKind) => {
    setBusy(true);
    try {
      const res = await fetch("/api/studio/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, kind, plannedFor: date }),
      });
      if (!res.ok) {
        toast("Couldn't save that plan.", "error");
        return;
      }
      setAdding(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: "planned" | "done" | "cancelled") => {
    setBusy(true);
    try {
      await fetch("/api/studio/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/studio/plan?id=${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leading }, (_, i) => (
          <div key={`pad-${i}`} />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const key = iso(new Date(year, month, day));
          const b = byDay.get(key);
          const isToday = key === today;

          return (
            <div
              key={key}
              className={cn(
                "min-h-[76px] rounded-xl border p-1.5 text-left transition",
                isToday ? "border-primary/50 bg-primary/[0.04]" : "border-border/60 bg-card",
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={cn("text-[11px] font-semibold tabular-nums", isToday && "text-primary")}>{day}</span>
                <button
                  type="button"
                  onClick={() => setAdding(adding === key ? null : key)}
                  aria-label={`Add a plan on ${key}`}
                  className="rounded p-0.5 text-muted-foreground opacity-0 transition hover:bg-secondary hover:text-foreground focus:opacity-100 group-hover:opacity-100 sm:opacity-60"
                >
                  <CalendarPlus className="h-3 w-3" aria-hidden />
                </button>
              </div>

              <div className="space-y-1">
                {b?.scheduled.map((s) => (
                  <p
                    key={s.id}
                    title={`Scheduled: ${s.title}`}
                    className="truncate rounded bg-blue-500/15 px-1 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300"
                  >
                    {s.title}
                  </p>
                ))}
                {b?.published.map((p) => (
                  <p
                    key={p.id}
                    title={`Published: ${p.title}`}
                    className="truncate rounded bg-emerald-500/12 px-1 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300"
                  >
                    {p.title}
                  </p>
                ))}
                {b?.plans.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setStatus(p.id, p.status === "done" ? "planned" : "done")}
                    disabled={busy}
                    title={`${PLAN_KIND_LABEL[p.kind]}: ${p.title}`}
                    className={cn(
                      "block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium transition",
                      KIND_TONE[p.kind],
                      p.status === "done" && "line-through opacity-60",
                      p.status === "cancelled" && "line-through opacity-40",
                    )}
                  >
                    {p.title}
                  </button>
                ))}
              </div>

              {adding === key ? (
                <PlanForm busy={busy} onCancel={() => setAdding(null)} onSave={(t, k) => createPlan(key, t, k)} />
              ) : null}
            </div>
          );
        })}
      </div>

      <ul className="mt-5 space-y-2">
        {plans.length === 0 ? null : <p className="text-xs font-semibold">This month&apos;s plans</p>}
        {plans.map((p) => (
          <li key={p.id} className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card p-2.5">
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", KIND_TONE[p.kind])}>
              {PLAN_KIND_LABEL[p.kind]}
            </span>
            <span className={cn("min-w-0 flex-1 truncate text-xs", p.status !== "planned" && "line-through opacity-60")}>
              {p.title}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{p.plannedFor.slice(5)}</span>
            <button
              type="button"
              onClick={() => setStatus(p.id, p.status === "done" ? "planned" : "done")}
              disabled={busy}
              aria-label={p.status === "done" ? `Mark ${p.title} as not done` : `Mark ${p.title} as done`}
              className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => remove(p.id)}
              disabled={busy}
              aria-label={`Delete ${p.title}`}
              className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanForm({
  busy,
  onCancel,
  onSave,
}: {
  busy: boolean;
  onCancel: () => void;
  onSave: (title: string, kind: PlanKind) => void;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<PlanKind>("idea");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSave(title.trim(), kind);
      }}
      className="mt-1.5 space-y-1"
      onClick={(e) => e.stopPropagation()}
    >
      <label className="sr-only" htmlFor="plan-title">
        Plan title
      </label>
      <input
        id="plan-title"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Idea…"
        maxLength={200}
        className="w-full rounded border border-border bg-background px-1 py-0.5 text-[10px] outline-none focus:border-primary/50"
      />
      <label className="sr-only" htmlFor="plan-kind">
        Kind
      </label>
      <select
        id="plan-kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as PlanKind)}
        className="w-full rounded border border-border bg-background px-1 py-0.5 text-[10px] outline-none focus:border-primary/50"
      >
        {PLAN_KINDS.map((k) => (
          <option key={k} value={k}>
            {PLAN_KIND_LABEL[k]}
          </option>
        ))}
      </select>
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="flex-1 rounded bg-primary px-1 py-0.5 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="mx-auto h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden /> : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="rounded bg-secondary px-1 py-0.5 text-muted-foreground"
        >
          <X className="h-3 w-3" aria-hidden />
        </button>
      </div>
    </form>
  );
}
