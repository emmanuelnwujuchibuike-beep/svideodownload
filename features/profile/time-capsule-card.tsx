"use client";

import { Clock, Lock, Loader2, Plus, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { MESSAGE_MAX, TITLE_MAX, type TimeCapsule } from "@/lib/social/time-capsules";
import { cn } from "@/lib/utils";

/** Tomorrow's date as a YYYY-MM-DD string — the min for the date input. The
 *  server enforces the real floor (MIN_SEAL_MS, 1 hour); this just steers the
 *  picker toward dates that are unambiguously in the future locally. */
function tomorrowDateInputValue(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatUnlockDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

/** Days until unlock, for a friendly "in 47 days" line alongside the exact date. */
function daysUntil(iso: string): number {
  return Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/**
 * Time Capsule™ (owner rail) — seal a private message that only becomes
 * readable on a future date you choose. Real, persisted (migration 0099):
 * locked capsules never have their message reach the client at all (see
 * lib/social/time-capsules.ts) — this component only ever receives `null`
 * for one it isn't allowed to read yet.
 */
export function TimeCapsuleCard({ initialCapsules }: { initialCapsules: TimeCapsule[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [unlockDate, setUnlockDate] = useState(tomorrowDateInputValue());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const minDate = useMemo(tomorrowDateInputValue, []);

  const seal = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/time-capsules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), message: message.trim(), unlockAt: new Date(`${unlockDate}T00:00:00`).toISOString() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't seal your capsule.");
        return;
      }
      setTitle("");
      setMessage("");
      setUnlockDate(tomorrowDateInputValue());
      setOpen(false);
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-tile text-white shadow-sm">
            <Clock className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold leading-tight">Time Capsule</h2>
            <p className="text-xs text-muted-foreground">Seal a message for your future self</p>
          </div>
        </div>
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="btn-lux-icon" aria-label="Seal a new capsule">
            <Plus className="h-[18px] w-[18px]" />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mb-4 rounded-2xl border border-border/60 bg-secondary/20 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground">New capsule</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cancel" className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={TITLE_MAX}
            placeholder={'Give it a title — "To me in a year"'}
            className="mb-2 h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={MESSAGE_MAX}
            rows={3}
            placeholder="What do you want to tell your future self?"
            className="mb-2 w-full resize-none rounded-xl bg-background p-3 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
          />
          <div className="mb-3 flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="capsule-unlock-date">
              Opens on
            </label>
            <input
              id="capsule-unlock-date"
              type="date"
              value={unlockDate}
              min={minDate}
              onChange={(e) => setUnlockDate(e.target.value)}
              className="h-9 rounded-lg bg-background px-2.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={seal} disabled={busy || !title.trim() || !message.trim()} className="btn-lux btn-lux-primary">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Seal it
            </button>
            {err ? <span className="text-xs font-medium text-red-400">{err}</span> : null}
          </div>
        </div>
      ) : null}

      {initialCapsules.length === 0 && !open ? (
        <p className="rounded-2xl border border-dashed border-border/60 p-4 text-center text-xs text-muted-foreground">
          Nothing sealed yet. Write something for a future birthday, anniversary, or just next year.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {initialCapsules.map((c) => (
            <li key={c.id} className={cn("rounded-2xl border p-3.5", c.locked ? "border-border/50 bg-secondary/20" : "border-border/60 bg-card")}>
              <div className="flex items-start gap-3">
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", c.locked ? "bg-secondary text-muted-foreground" : "bg-brand-tile text-white")}>
                  {c.locked ? <Lock className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{c.title}</p>
                  {c.locked ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Opens {formatUnlockDate(c.unlockAt)} · {daysUntil(c.unlockAt)} day{daysUntil(c.unlockAt) === 1 ? "" : "s"} to go
                    </p>
                  ) : (
                    <>
                      <p className="mt-0.5 text-xs text-muted-foreground">Unlocked {formatUnlockDate(c.unlockAt)}</p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{c.message}</p>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
