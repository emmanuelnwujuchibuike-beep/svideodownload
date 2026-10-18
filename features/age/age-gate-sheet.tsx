"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Portal } from "@/components/ui/portal";
import { BIRTH_DATE_PROBLEM_TEXT, checkBirthDate, isoDate, todayUtc } from "@/lib/age/age";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * The age check (0261, owner 2026-10-18: "Date of birth + 18+ confirm"), opened from a Mature (18+)
 * post that the server withheld. The date is checked here only to answer at once — the server
 * decides from the date it is sent and keeps only the outcome, never the date. An adult answer is
 * final; a minor's stands until the day they turn 18, and the sheet says so plainly.
 *
 * Loaded only when a Mature post is tapped (the callers import it with next/dynamic), so it is in
 * no route's first load.
 */
export function AgeGateSheet({ onClose, onVerified }: { onClose: () => void; onVerified: () => void }) {
  const [birthDate, setBirthDate] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minorUntil, setMinorUntil] = useState<string | null>(null);
  const titleId = useId();
  const dateId = useId();
  const firstField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const checked = checkBirthDate(birthDate);
    if (!checked.ok) return setError(BIRTH_DATE_PROBLEM_TEXT[checked.problem]);
    setBusy(true);
    const res = await fetch("/api/age", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ birthDate, confirm: confirmed }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { status?: string; eligibleOn?: string | null; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !j) return setError(j?.error ?? "Couldn't check that. Try again.");
    if (j.status === "adult") {
      haptic("selection");
      onVerified();
      return;
    }
    setMinorUntil(j.eligibleOn ?? null);
  };

  const until = minorUntil ? new Date(`${minorUntil}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null;

  return (
    <Portal>
      <div className="frenz-ui fixed inset-0 z-[90] flex items-end justify-center bg-black/45 sm:items-center" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-t-[28px] border border-frenz-line bg-frenz-card px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4 text-frenz-ink shadow-frenz-float sm:rounded-[28px] sm:pb-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-xl bg-frenz-fill font-heading text-[13px] font-extrabold">
                18+
              </span>
              <h2 id={titleId} className="m-0 font-heading text-lg font-bold">
                {minorUntil ? "Not available yet" : "Confirm your age"}
              </h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center rounded-full text-frenz-muted transition hover:bg-frenz-fill">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          {minorUntil ? (
            <>
              <p className="mt-3 text-[15px] leading-relaxed text-frenz-muted">
                Mature posts are for people 18 and older.{until ? ` You can open them from ${until}.` : ""} Everything else on Frenz is open to you.
              </p>
              <button type="button" onClick={onClose} className="mt-5 flex min-h-12 w-full items-center justify-center rounded-full border border-frenz-line bg-frenz-card text-[15px] font-bold">
                OK
              </button>
            </>
          ) : (
            <form onSubmit={(e) => void submit(e)} noValidate>
              <p className="mt-3 text-[15px] leading-relaxed text-frenz-muted">This post is marked Mature (18+). Enter your date of birth once. We keep only whether you&apos;re 18 or older, never the date.</p>
              <label htmlFor={dateId} className="mt-4 block text-[13px] font-semibold">
                Date of birth
              </label>
              <input
                ref={firstField}
                id={dateId}
                type="date"
                required
                value={birthDate}
                max={isoDate(todayUtc())}
                min="1900-01-01"
                onChange={(e) => setBirthDate(e.target.value)}
                aria-invalid={!!error}
                className="mt-1.5 min-h-12 w-full rounded-2xl border-0 bg-frenz-fill px-4 text-[16px] text-frenz-ink outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet/40"
              />
              <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 text-[14px] leading-snug">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[hsl(var(--frenz-violet))]" />
                <span>I confirm I&apos;m 18 or older and that the date above is true.</span>
              </label>
              {error ? (
                <p role="alert" className="mt-2 text-[13px] font-medium text-rose-600 dark:text-rose-400">
                  {error}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={busy || !birthDate}
                className={cn("mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-frenz-gradient text-[15px] font-bold text-white transition active:scale-[0.99] disabled:opacity-50")}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Continue
              </button>
              <p className="mt-3 text-center text-[12px] text-frenz-muted">You can&apos;t change your answer later.</p>
            </form>
          )}
        </div>
      </div>
    </Portal>
  );
}
