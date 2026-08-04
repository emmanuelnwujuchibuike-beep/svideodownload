"use client";

import { Star, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getCompletedCount, onDownloadCompleted } from "@/features/downloads/manager";
import { cn } from "@/lib/utils";

/**
 * "How's Frenz?" — after two successful downloads, then not again for a fortnight.
 *
 * ── The brief was "not intrusive", so the rules are strict ────────────────
 *  · It never appears before the SECOND completed download. One download is
 *    not enough experience to have an opinion worth collecting.
 *  · It is a bottom card, not a modal. Nothing is blocked, nothing is
 *    dimmed, and the page underneath stays usable — a rating request that
 *    interrupts a task is how you get a 1-star rating about the request.
 *  · Answering OR dismissing buys two weeks of silence, and after that it
 *    takes two more downloads to ask again. Dismissal is treated exactly like
 *    a rating, so "no thanks" is never punished with a sooner re-ask.
 *  · It waits for the download card to clear, so the two never stack.
 *
 * ── Why the state is local-only ──────────────────────────────────────────
 * Whether someone has been ASKED is a device concern, not an account one, and
 * storing it server-side would mean a write for every visitor who was merely
 * shown a card. localStorage answers it for free, works for the signed-out
 * majority, and fails safe: with storage unavailable the prompt never shows,
 * which is the quiet failure rather than the nagging one.
 */

const SEEN_KEY = "frenz:rating-prompt";
const AFTER_DOWNLOADS = 2;
/** Long enough for the download card to auto-dismiss (6s) and be gone. */
const DELAY_MS = 7_000;
/**
 * How long an answer (or a dismissal) is remembered before we may ask again
 * (owner: two weeks, then re-prompt after two more downloads).
 *
 * Two weeks, rather than never, because an opinion formed on day one is about
 * a different product than the one they'll be using a month later — and someone
 * who rated 2 stars because of a bug that has since been fixed should get the
 * chance to say so. It applies to signed-in members and guests alike, which is
 * why it lives in localStorage: it is a per-device courtesy, not an account
 * fact, and it works for the signed-out majority who use the downloader.
 */
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

type State = "hidden" | "asking" | "thanks";

interface SeenRecord {
  at: number;
  outcome: "dismissed" | "rated";
}

/** Reads the stored record, tolerating the old plain-string format. */
function readSeen(): SeenRecord | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    // v1 wrote the bare word "dismissed"/"rated" with no timestamp. Treat it as
    // "just now" so an existing device serves out a fresh cooldown rather than
    // being re-prompted the moment this ships.
    if (raw === "dismissed" || raw === "rated") return { at: Date.now(), outcome: raw };
    const parsed = JSON.parse(raw) as Partial<SeenRecord>;
    if (typeof parsed?.at !== "number") return null;
    return { at: parsed.at, outcome: parsed.outcome === "rated" ? "rated" : "dismissed" };
  } catch {
    return null;
  }
}

/**
 * True when we must NOT ask right now.
 *
 * Storage being unavailable counts as "handled": without somewhere to record
 * the answer we would ask on every single page load, which is precisely the
 * nagging the brief rules out. Failing silent is the right direction here.
 */
function inCooldown(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
  } catch {
    return true;
  }
  const seen = readSeen();
  if (!seen) return false;
  return Date.now() - seen.at < COOLDOWN_MS;
}

function remember(outcome: "dismissed" | "rated") {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ at: Date.now(), outcome } satisfies SeenRecord));
  } catch {
    /* nothing to do — the in-memory state still hides it for this session */
  }
}

/**
 * The analytics visitor id, so a guest's rating can be de-duplicated across
 * sessions. Read from localStorage, which is where `lib/analytics/client` puts
 * it — NOT a cookie, and reading one would have silently returned undefined for
 * every guest, making the unique index useless.
 *
 * Only ever read: this never creates an id, so a visitor who has opted out of
 * analytics stays without one and simply isn't de-duplicated.
 */
function visitorId(): string | undefined {
  try {
    return localStorage.getItem("frenz_vid") ?? undefined;
  } catch {
    return undefined;
  }
}

export function RatingPrompt({ surface = "downloads" }: { surface?: "landing" | "downloads" | "history" }) {
  const [state, setState] = useState<State>("hidden");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (inCooldown()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const maybeAsk = () => {
      if (getCompletedCount() < AFTER_DOWNLOADS || inCooldown()) return;
      // Let the download card finish its own business first.
      timer = setTimeout(() => setState((s) => (s === "hidden" ? "asking" : s)), DELAY_MS);
    };

    // Someone arriving with downloads already behind them this session counts.
    maybeAsk();
    const off = onDownloadCompleted(maybeAsk);
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const dismiss = useCallback(() => {
    remember("dismissed");
    setState("hidden");
  }, []);

  const submit = useCallback(
    async (value: number) => {
      setBusy(true);
      // Remembered BEFORE the request: whether we asked is settled the moment
      // they answer, and a network failure must not mean being asked again.
      remember("rated");
      try {
        await fetch("/api/ratings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating: value,
            comment: comment.trim() || undefined,
            downloads: getCompletedCount(),
            surface,
            visitorId: visitorId(),
          }),
        });
      } catch {
        /* their rating is recorded as "given" either way — never re-ask */
      } finally {
        setBusy(false);
        setState("thanks");
        setTimeout(() => setState("hidden"), 2600);
      }
    },
    [comment, surface],
  );

  if (state === "hidden") return null;

  return (
    <div
      role="dialog"
      aria-label="Rate Frenz"
      className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[80] mx-auto max-w-md animate-in fade-in slide-in-from-bottom-4 duration-300 motion-reduce:animate-none lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-96"
    >
      <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/95 p-4 shadow-elevated backdrop-blur-xl">
        <button
          type="button"
          onClick={dismiss}
          aria-label="No thanks"
          className="absolute right-3 top-3 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        {state === "thanks" ? (
          <p className="py-2 text-sm font-semibold">Thank you — that helps.</p>
        ) : (
          <>
            <p className="pr-8 text-sm font-bold">Enjoying Frenz?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              You&apos;ve saved a couple of downloads. How&apos;s it going?
            </p>

            <div className="mt-3 flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  onClick={() => setRating(n)}
                  aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  aria-pressed={rating === n}
                  className="rounded-lg p-1 transition active:scale-90 disabled:opacity-50"
                >
                  <Star
                    className={cn(
                      "h-7 w-7 transition",
                      n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
                    )}
                  />
                </button>
              ))}
            </div>

            {/* The comment box appears only once they've picked a score — asking
                for prose up front is what makes a rating card feel like work. */}
            {rating > 0 ? (
              <div className="mt-3">
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={1000}
                  rows={2}
                  placeholder={rating <= 3 ? "What went wrong? (optional)" : "Anything you'd like to add? (optional)"}
                  className="w-full resize-none rounded-xl bg-background p-3 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submit(rating)}
                    className="btn-lux btn-lux-primary !py-2 !text-xs"
                  >
                    {busy ? "Sending…" : "Send"}
                  </button>
                  <button
                    type="button"
                    onClick={dismiss}
                    className="px-2 py-2 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    No thanks
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
