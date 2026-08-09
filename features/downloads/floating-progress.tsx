"use client";

import {
  Check,
  ChevronUp,
  Download,
  History,
  Image as ImageIcon,
  Loader2,
  Minus,
  Play,
  PlaySquare,
  RotateCcw,
  Share,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";

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

/**
 * How long a download runs before we stop pretending it is nearly done and
 * offer somewhere to go instead (owner, 2026-08-09).
 *
 * Eight seconds because that is roughly where "it's about to finish" stops
 * being a reasonable thing to believe. Below it, offering an escape route reads
 * as us apologising for something that was fine; above it, a visitor staring at
 * a progress bar has already been given nothing to do for too long.
 */
const SLOW_MS = 8_000;

/**
 * "Your download is done" — for the visitor who took us up on the offer and
 * wandered off to the wallpapers.
 *
 * ── Why the system notification is opportunistic ──────────────────────────────
 * It fires only when permission is ALREADY granted and only while the tab is
 * hidden. Asking for notification permission because someone downloaded a video
 * is the exact prompt-spam that makes people block a site forever, and a
 * notification for a tab you are currently looking at is noise — the card is
 * right there. The card, the sound and the haptic are the notification when the
 * tab is in front.
 */
function notifyComplete(title: string): void {
  try {
    if (typeof document === "undefined" || !document.hidden) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification("Download complete", {
      body: title || "Your file is ready to save.",
      icon: "/icon-192.png",
      tag: "frenz-download-complete",
    });
  } catch {
    /* notifications unavailable — the card still says so */
  }
}

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
export function FloatingDownloadProgress({
  /**
   * Which layer to sit on. Defaults to the app-wide 85, which is above the page
   * and below every sheet and menu.
   *
   * The wallpaper surfaces override it: the reels viewer is a full-screen
   * `z-[100]` overlay, so at 85 the progress card was rendering BEHIND the
   * wallpaper — a member tapping Download in the viewer got a card they could
   * not see and no sign anything had happened (owner, 2026-08-09). Raising it
   * globally would put a download card over every dialog in the app instead, so
   * the surface that needs it asks for it.
   */
  layerClass = "z-[85]",
}: { layerClass?: string } = {}) {
  const claimed = useRef(false);
  const tasks = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  /*
    Minimised state (owner, 2026-08-09): "make users who are downloading a file
    taking longer to be able to minimise and be directed to view wallpaper or
    watch reels while download is processing in background".

    Local state, not manager state, and that is the right place for it: minimising
    is a preference about THIS screen. The transfer already runs in the background
    — it is a fetch in a module-level manager, entirely independent of this card —
    so hiding the card changes nothing about the download, which is exactly the
    promise being made.
  */
  const [minimised, setMinimised] = useState(false);
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

  /*
    A finished download ALWAYS comes back into view, even if the card was
    minimised and the visitor is three wallpapers deep.

    This is the other half of the offer: sending someone away mid-download is
    only honest if the result finds them again. Leaving the bubble collapsed
    would mean the file quietly finished behind a dot — and "Save to device" on
    iOS needs a real tap, so a hidden completion is a download that never lands.
  */
  const finishedStatus = task && !isActive(task.status) ? task.status : null;
  useEffect(() => {
    if (!finishedStatus) return;
    setMinimised(false);
  }, [finishedStatus, task?.id]);

  // The completion alert itself — sound and haptic for the visitor who is
  // watching, a system notification for the one who isn't. Keyed on the task id
  // so a batch announces each file once and never re-announces on a re-render.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!task || task.status !== "completed" || !claimed.current) return;
    if (announced.current === task.id) return;
    announced.current = task.id;
    haptic("medium");
    playSound("mention");
    notifyComplete(task.title);
  }, [task?.id, task?.status]);

  // The prompt owns its own timing, dismissal and "already asked" memory; this
  // only decides when the chunk is worth fetching at all.
  const askForRating = claimed.current && completed >= RATING_AFTER;

  if (!claimed.current || !task) return askForRating ? <RatingPrompt /> : null;

  const pct = task.totalBytes > 0 ? Math.min(100, Math.round((task.receivedBytes / task.totalBytes) * 100)) : null;
  const remaining = eta(task);
  const running = isActive(task.status);
  /*
    "Taking longer" — the trigger for the escape hatch.

    `slowPrepare` covers the case with no progress to show at all (the server is
    still muxing a large file); the elapsed check covers a transfer that is
    simply big. Elapsed is read from `createdAt` on each render rather than from
    a timer, because a running download re-renders this component constantly and
    a `preparing` one flips `slowPrepare` at six seconds — so both states already
    have something waking us up, and an interval would only add a second one.
  */
  const takingLong = running && (task.slowPrepare === true || Date.now() - task.createdAt > SLOW_MS);

  /* ── Minimised: a thumb-sized bubble, and nothing else ──────────────────────
     Everything the card was saying collapses to the one number that matters and
     the fact that it is still moving. It stays a real button with a real label,
     so restoring it is one tap and a screen reader still announces the state. */
  if (minimised && running) {
    return (
      <button
        type="button"
        onClick={() => {
          haptic("light");
          setMinimised(false);
        }}
        aria-label={`Download in progress${pct !== null ? `, ${pct} percent` : ""} — tap to expand`}
        className={cn(
          "fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-3 flex items-center gap-2 rounded-full border border-border/60 bg-card/95 py-2 pl-2 pr-3.5 shadow-elevated backdrop-blur-xl transition active:scale-95 lg:bottom-6 lg:right-6",
          layerClass,
        )}
      >
        <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#2563FF] to-[#6D5CFF] text-white">
          <Download className="h-4 w-4" />
          <span
            aria-hidden
            className="absolute inset-0 animate-ping rounded-full bg-[#2563FF]/30 motion-reduce:animate-none"
          />
        </span>
        <span className="text-xs font-bold tabular-nums">
          {pct !== null ? `${pct}%` : "Working…"}
        </span>
        <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    );
  }

  return (
    /*
      ── Why this slide-up is CSS and not framer-motion ────────────────────────
      This component is statically imported by `Downloader`, and `Downloader` is
      on the landing page. That one import was putting the WHOLE of
      framer-motion — 39 kB gzipped, 13% of the cold-entry budget — in front of
      every first-time visitor, to spring a card that only ever appears after
      they have already started a download.

      Re-keying on `task.id + task.status` is what replays it on each state
      change, exactly as the old AnimatePresence key did. There is no exit
      animation any more and it isn't missed: a completed card auto-dismisses on
      a timer and a dismissed one should leave the moment it is tapped.
    */
    <div
      key={task.id + task.status}
      className={cn(
        "fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] mx-auto max-w-md animate-in fade-in slide-in-from-bottom-8 duration-300 [animation-timing-function:var(--ease-out)] motion-reduce:animate-none lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-96",
        layerClass,
      )}
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

              {/*
                ── Somewhere to go while it finishes (owner, 2026-08-09) ───────
                "be directed to view wallpaper or watch reels while download is
                processing in background".

                Only once it is genuinely taking a while. Offering an exit from
                a download that finishes in two seconds reads as an apology for
                something that was fine, and it would put two links under every
                single transfer.

                Tapping one minimises the card on the way out rather than
                dismissing it: the download keeps running (it always did — the
                manager owns it, not this card), and the bubble stays as proof,
                so nobody has to wonder whether leaving cancelled it. The card
                un-minimises itself the moment the file lands.
              */}
              {takingLong ? (
                <div className="mt-3 rounded-2xl bg-secondary/60 p-2.5">
                  <p className="px-1 text-[11px] font-semibold text-muted-foreground">
                    This one&apos;s big — it keeps going in the background. Have a look around?
                  </p>
                  {/*
                    ── Premium, and alive (owner, 2026-08-09) ──────────────────
                    "make the view wallpaper and watch reels buttons more
                    premium and luxurious, it should feel alive, and it should
                    always prefetch instant and never load when clicked."

                    Three separate asks, three separate answers:

                    • PREMIUM — a tinted gradient tile with its own coloured
                      icon chip and a light sweeping across it, rather than two
                      grey pills. They are the only way out of a wait, so they
                      should look worth taking.

                    • ALIVE — the sweep runs on a slow loop while the card is
                      up, staggered between the two so they breathe rather than
                      blink in unison. It is `transform`-only, so it costs the
                      compositor and nothing else, and it exists only while a
                      download is genuinely slow — never on an idle page.

                    • NEVER LOADS — `prefetch` warms the route as soon as the
                      card appears, and both destinations have a `loading.tsx`,
                      so the shell paints on the tap and the data streams in
                      behind it. Prefetch alone would still show a blank frame
                      on a cold route; the pair is what makes it instant.
                  */}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Link
                      href="/wallpapers"
                      prefetch
                      onClick={() => setMinimised(true)}
                      className="frenz-alive group relative flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-br from-violet-500/12 to-fuchsia-500/10 px-3 py-2.5 text-xs font-bold ring-1 ring-inset ring-violet-400/25 transition hover:ring-violet-400/60 active:scale-95"
                    >
                      <span
                        aria-hidden
                        className="frenz-alive-sheen pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/20"
                      />
                      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-sm">
                        <ImageIcon className="h-3.5 w-3.5" />
                      </span>
                      <span className="relative">Wallpapers</span>
                    </Link>
                    <Link
                      href="/reels"
                      prefetch
                      onClick={() => setMinimised(true)}
                      className="frenz-alive frenz-alive-2 group relative flex items-center justify-center gap-2 overflow-hidden rounded-xl bg-gradient-to-br from-blue-500/12 to-violet-500/10 px-3 py-2.5 text-xs font-bold ring-1 ring-inset ring-blue-400/25 transition hover:ring-blue-400/60 active:scale-95"
                    >
                      <span
                        aria-hidden
                        className="frenz-alive-sheen pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/20"
                      />
                      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-sm">
                        {/* A video glyph, not a sparkle (owner): the icon should
                            say what is on the other side of the tap. */}
                        <PlaySquare className="h-3.5 w-3.5" />
                      </span>
                      <span className="relative">Watch reels</span>
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-center gap-1">
              {/* Minimise — offered on ANY running download, not just a slow one:
                  by the time someone wants the card out of the way they should not
                  have to wait for us to agree that it is taking too long. */}
              {running ? (
                <button
                  type="button"
                  aria-label="Minimise — keep downloading in the background"
                  onClick={() => {
                    haptic("light");
                    setMinimised(true);
                  }}
                  className="rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <Minus className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label={running ? "Cancel download" : "Dismiss"}
                onClick={() => (running ? cancelDownload(task.id) : dismissTask(task.id))}
                className="rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
      </div>
    </div>
  );
}
