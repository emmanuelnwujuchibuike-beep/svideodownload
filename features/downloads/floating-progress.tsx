"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Download, History, Loader2, Play, RotateCcw, Share, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { useUser } from "@/features/auth/use-user";
import {
  cancelDownload,
  dismissTask,
  getCompletedCount,
  getServerSnapshot,
  getSnapshot,
  retryDownload,
  saveAllToDevice,
  saveTaskToDevice,
  subscribe,
  type DownloadTask,
} from "@/features/downloads/manager";
import { usePlayerQueue } from "@/features/downloads/player-store";
import type { DownloadRecord } from "@/types";
import { cn } from "@/lib/utils";

/* `taskToRecord` lived here to build a one-off record for an isolated player.
   Reviewing now links into the history page instead (see the Review button), so
   the record comes from history itself and the shim is gone. */

function fmtBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} GB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} KB`;
  return `${n} B`;
}

function eta(t: DownloadTask): string | null {
  if (!t.totalBytes || !t.speed || t.speed < 1) return null;
  const s = Math.ceil((t.totalBytes - t.receivedBytes) / t.speed);
  if (s < 1) return null;
  if (s < 60) return `${s}s left`;
  return `${Math.ceil(s / 60)}m left`;
}

/**
 * The rating prompt (owner: ask after two successful downloads).
 *
 * Mounted from HERE rather than from each page, for two reasons: this component
 * is already on every surface a download can finish on, and it already
 * subscribes to completions — so the prompt costs one dynamic import instead of
 * a new client boundary on each page.
 *
 * `ssr: false` and gated on the count, so the chunk is fetched only once someone
 * has actually completed their second download. The landing sits at its
 * cold-entry ceiling with no headroom, and a rating card is the last thing that
 * should be in a first-time visitor's critical path.
 */
const RatingPrompt = dynamic(() => import("@/features/feedback/rating-prompt").then((m) => m.RatingPrompt), {
  ssr: false,
});

const RATING_AFTER = 2;

// Only one card layer app-wide even if two surfaces mount it (app shell +
// landing downloader) — the first mount wins.
let layerClaimed = false;

/**
 * The floating download card — the "never get stuck on a preview page"
 * experience. Downloads run in the background (streamed, with real progress);
 * this card shows percentage / size / speed / time left wherever the user is,
 * without blocking anything. On completion: desktop/Android auto-save and show
 * a success card; iOS shows "Save to device" (the share sheet — the ONE path
 * that reliably lands a video in Photos/Files from a web app — needs a real
 * tap, so it waits for one here instead of navigating to a Quick Look page).
 */
export function FloatingDownloadProgress() {
  const claimed = useRef(false);
  const tasks = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Where the "Downloads" button lands: the public library for signed-out
  // visitors (no login wall), the full dashboard for signed-in ones.
  const { user } = useUser();
  const downloadsHref = user ? "/downloads" : "/library";

  useEffect(() => {
    if (!layerClaimed) {
      layerClaimed = true;
      claimed.current = true;
      return () => {
        layerClaimed = false;
      };
    }
    return undefined;
  }, []);

  // Auto-dismiss completed cards that need no further action.
  const isActive = (s: DownloadTask["status"]) => s === "downloading" || s === "queued" || s === "preparing";
  const activeCount = tasks.filter((t) => isActive(t.status)).length;
  const active = tasks.find((t) => isActive(t.status));
  const finished = tasks.find((t) => t.status === "completed" || t.status === "failed");
  const task = active ?? finished;
  // Hold the card while the review player is open — closing the player must
  // return the visitor to the card and its Save to device / Download history
  // buttons, not to an empty screen because it timed out mid-review.
  const reviewing = usePlayerQueue() !== null;
  // How many finished files are still waiting to be handed to the device — the
  // whole batch, not just the one this card happens to be showing.
  const awaitingCount = tasks.filter((t) => t.status === "completed" && t.awaitingSave).length;
  // Completed downloads THIS session — the rating prompt's trigger.
  //
  // The MONOTONIC counter, not a filter over `tasks`: a completed card is
  // dismissed after a few seconds, so counting the live list would climb to two
  // and then fall back to zero, and the prompt would never appear for anyone who
  // let their cards auto-dismiss — which is everyone. This component re-renders
  // on every task change, so reading it during render is enough to observe it.
  const completed = getCompletedCount();
  useEffect(() => {
    if (!task || task.status !== "completed" || task.awaitingSave || reviewing) return;
    const t = setTimeout(() => dismissTask(task.id), 6000);
    return () => clearTimeout(t);
  }, [task, reviewing]);

  // The prompt owns its own timing, dismissal and "already asked" memory; this
  // only decides when the chunk is worth fetching at all.
  const askForRating = claimed.current && completed >= RATING_AFTER;

  if (!claimed.current || !task) return askForRating ? <RatingPrompt /> : null;

  const pct = task.totalBytes > 0 ? Math.min(100, Math.round((task.receivedBytes / task.totalBytes) * 100)) : null;
  const remaining = eta(task);

  return (
    <AnimatePresence>
      <motion.div
        key={task.id + task.status}
        initial={{ y: 72, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 72, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[85] mx-auto max-w-md lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-96"
        role="status"
        aria-live="polite"
      >
        <div className="lux-enter relative overflow-hidden rounded-3xl border border-border/60 bg-card/95 p-4 shadow-elevated backdrop-blur-xl">
          {/* A hairline of brand light across the top edge — the whole card is
              otherwise white, so this is the only colour it needs to read as
              considered rather than plain. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#2563FF]/60 to-transparent"
          />
          {/* A soft radial behind the status badge, the same restraint the
              profile header uses: depth from light, not from a coloured block. */}
          <span
            aria-hidden
            className="pointer-events-none absolute -left-8 -top-10 h-32 w-32 rounded-full bg-[radial-gradient(circle,rgba(37,99,255,0.10),transparent_70%)]"
          />
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset transition",
                task.status === "failed"
                  ? "bg-rose-500/12 text-rose-500 ring-rose-500/20"
                  : task.status === "completed"
                    ? "bg-emerald-500/12 text-emerald-500 ring-emerald-500/20"
                    : "bg-gradient-to-br from-[#2563FF] to-[#6D5CFF] text-white shadow-[0_6px_16px_-8px_rgba(37,99,255,0.7)] ring-white/20",
              )}
            >
              {task.status === "completed" ? (
                <Check className="h-5 w-5" />
              ) : task.status === "failed" ? (
                <X className="h-5 w-5" />
              ) : (
                <Download className="h-5 w-5" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-snug">
                {task.status === "completed"
                  ? task.awaitingSave
                    ? awaitingCount > 1
                      ? `${awaitingCount} files ready to save`
                      : "Ready — save it to your device"
                    : "Download complete"
                  : task.status === "failed"
                    ? "Download failed"
                    : activeCount > 1
                      ? `Downloading ${activeCount} items…`
                      : task.status === "preparing"
                        ? task.slowPrepare
                          ? "Still preparing — large file"
                          : "Preparing your file…"
                        : task.status === "queued"
                          ? (task.attempts ?? 1) > 1
                            ? "Hit a snag — trying again…"
                            : "Queued…"
                          : "Downloading…"}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{task.title || "Your file"}</p>

              {/*
                Say what is happening, in the two cases where silence reads as
                a hang. A large file genuinely takes time to mux, and a retry
                is us fixing our own hiccup — neither is the member's problem
                to solve, and both are better than a spinner with no words.
              */}
              {task.status === "preparing" && task.slowPrepare ? (
                <p className="mt-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                  This is a large file, so it takes a little longer to put together. It will start on its own —
                  no need to wait here.
                </p>
              ) : null}
              {task.status === "queued" && (task.attempts ?? 1) > 1 ? (
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  The server hiccuped. Retrying automatically — attempt {task.attempts} of 3.
                </p>
              ) : null}

              {isActive(task.status) ? (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                    {pct === null ? (
                      <div className="h-full w-1/3 animate-[shimmer_1.2s_infinite] rounded-full bg-gradient-to-r from-blue-500 to-violet-500" />
                    ) : (
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
                    )}
                  </div>
                  <p className="mt-1.5 flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
                    {pct !== null ? <span className="font-semibold text-foreground">{pct}%</span> : <Loader2 className="h-3 w-3 animate-spin" />}
                    <span>
                      {fmtBytes(task.receivedBytes)}
                      {task.totalBytes ? ` / ${fmtBytes(task.totalBytes)}` : ""}
                    </span>
                    {task.speed > 1 ? <span>· {fmtBytes(task.speed)}/s</span> : null}
                    {remaining ? <span>· {remaining}</span> : null}
                  </p>
                </>
              ) : task.status === "failed" ? (
                <p className="mt-1 text-xs text-rose-400">{task.error || "Check your connection and retry."}</p>
              ) : null}

              {/* Actions */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {/* One tap for the WHOLE batch. iOS's share sheet takes an
                    array of files, so eight story snaps land in Photos in a
                    single action instead of eight taps and eight sheets. Only
                    shown when more than one file is actually waiting. */}
                {task.status === "completed" && task.awaitingSave && awaitingCount > 1 ? (
                  <button
                    type="button"
                    onClick={() => void saveAllToDevice()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 active:scale-95"
                  >
                    <Share className="h-3.5 w-3.5" /> Save all {awaitingCount}
                  </button>
                ) : null}
                {task.status === "completed" && task.awaitingSave ? (
                  <button
                    type="button"
                    onClick={() => void saveTaskToDevice(task.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition active:scale-95",
                      // Saving the whole batch is the action people want when
                      // several are waiting, so this steps down to secondary
                      // rather than competing with it as a second blue button.
                      awaitingCount > 1
                        ? "border border-border/70 hover:bg-secondary"
                        : "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25 hover:opacity-95",
                    )}
                  >
                    <Share className="h-3.5 w-3.5" /> {awaitingCount > 1 ? "Save this one" : "Save to device"}
                  </button>
                ) : null}
                {task.status === "completed" ? (
                  <Link
                    href={downloadsHref}
                    prefetch
                    onClick={() => dismissTask(task.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 px-3 py-2 text-xs font-semibold transition hover:bg-secondary"
                  >
                    <History className="h-3.5 w-3.5" /> Download history
                  </Link>
                ) : null}
                {task.status === "completed" ? (
                  /*
                    Reviewing opens the clip INSIDE the history page (owner,
                    2026-08-04) rather than in an isolated player over whatever
                    page the download happened on.

                    Why that's better: history is where the clip actually lives,
                    and opening it there means the player has the whole library
                    as its queue — so it auto-advances to the next download and
                    the visitor lands somewhere useful when they close it. The
                    old behaviour opened a single-item player over the landing
                    page and left them exactly where they started.

                    `?review=<id>` is read by the history page, which opens the
                    player seeded at that item; an id that isn't there yet just
                    shows history, so this can never dead-end.
                  */
                  <Link
                    href={`/history?review=${encodeURIComponent(task.id)}`}
                    prefetch
                    onClick={() => dismissTask(task.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 px-3 py-2 text-xs font-semibold transition hover:bg-secondary"
                  >
                    <Play className="h-3.5 w-3.5" />{" "}
                    {task.kind === "audio" ? "Review audio" : task.kind === "image" ? "View image" : "Review video"}
                  </Link>
                ) : null}
                {task.status === "failed" ? (
                  <button
                    type="button"
                    onClick={() => retryDownload(task.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:opacity-95 active:scale-95"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Retry
                  </button>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              aria-label={isActive(task.status) ? "Cancel download" : "Dismiss"}
              onClick={() => (isActive(task.status) ? cancelDownload(task.id) : dismissTask(task.id))}
              className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
