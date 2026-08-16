"use client";

import {
  Check,
  ChevronRight,
  ChevronUp,
  Download,
  History,
  Image as ImageIcon,
  Loader2,
  Minus,
  Play,
  RotateCcw,
  Share,
  Sparkles,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

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
import { RewardConsentSheet } from "@/features/monetization/reward-consent-sheet";
import { useRewardFlow } from "@/features/monetization/use-reward-flow";
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
 * The rating prompt — see features/feedback/rating-prompt.tsx for the actual
 * trigger rules (a batch asks on its first completion, a single download on
 * its second TODAY, both device-persisted).
 *
 * Mounted from HERE rather than from each page, for two reasons: this component
 * is already on every surface a download can finish on, and it already
 * subscribes to completions — so the prompt costs one dynamic import instead of
 * a new client boundary on each page.
 *
 * `ssr: false` and gated on `completed >= 1`, so the chunk is fetched only once
 * someone has actually completed a download this session — never on the
 * landing's cold-entry critical path for a visitor who hasn't downloaded
 * anything yet.
 *
 * 🔴 NOT gated on 2 (owner, 2026-08-16: a batch's first completion, or a
 * single download that happens to be today's SECOND because the first one
 * ran in an earlier session, both have to be able to ask on THIS session's
 * very first completion). Gating on 2 here would mean the component — and
 * the `onDownloadCompleted` subscription that has to observe every
 * completion to evaluate those rules — never mounts in time to see the one
 * that qualifies.
 */
const RatingPrompt = dynamic(() => import("@/features/feedback/rating-prompt").then((m) => m.RatingPrompt), {
  ssr: false,
});

const RATING_AFTER = 1;

/**
 * The one sentence shown whenever a download is taking a while — as the reason
 * the card is still up, and as the heading over the two places to go.
 *
 * Owner, 2026-08-09: "the 'this file is big have a look around' and the large
 * file text should just be 'please wait, have a look around while is
 * downloading in background'". It was two different sentences that both
 * asserted the file was large — which we do not actually know at that point,
 * only that the server has not answered yet.
 */
/*
  🔴 SUPERSEDED WORDING (owner, 2026-08-10, with `public/waiting premium
  button.jpg`: "text and texture and color and everything exactly in the image").

  This read "Please wait — have a look around while it downloads in the
  background.", itself an owner rewrite from 2026-08-09. The reference image
  draws a heading and a sentence as two separate things, so the sentence no
  longer has to carry the invitation — "Almost there!" sits above it and the two
  tiles below say where to go. What is left is the reference's own line.

  It also stays honest about the same thing the 08-09 rewrite was protecting: it
  claims the download is PREPARING, not that the file is large, because at this
  point all we know is that the server has not answered yet.
*/
const WAIT_COPY = "Please wait while your download prepares in the background.";

/**
 * One gradient tile in the wait panel — built to `public/waiting premium
 * button.jpg`.
 *
 * ── What the reference actually contains, layer by layer ─────────────────────
 *
 * The tiles are not flat gradients with an icon. Reproducing them means four
 * stacked layers, in this paint order:
 *
 *  1. The base gradient. Violet → indigo on the left tile, sky → indigo on the
 *     right one. Both travel toward the SAME indigo, which is what makes the
 *     pair read as one family rather than as two unrelated buttons.
 *  2. The wave texture — the soft lighter S-curve sweeping through the left
 *     tile. Two large, very low-opacity white radial gradients at different
 *     offsets, which is enough to read as an organic wave without an image. A
 *     texture worth zero bytes: this card can appear on the landing page, which
 *     has no budget for a decorative asset.
 *  3. The glass rim — a white top-edge highlight plus an inset ring. This is
 *     what makes the tile look like lit glass instead of painted plastic, and it
 *     is the single most identifiable thing about the reference.
 *  4. The content row: circular translucent disc, title, two-line subtitle, and
 *     a circular chevron.
 *
 * ── The coloured glow ────────────────────────────────────────────────────────
 * Each tile casts a shadow in its OWN hue, which is why the reference tiles look
 * lit from within. A neutral shadow under a saturated tile reads as dirt.
 *
 * ── Kept from the previous version, because the owner asked for them ─────────
 * `prefetch` plus each destination's `loading.tsx` is what makes the tap instant
 * ("never load when clicked"), and the sheen loop is the "alive" ask. The sheen
 * exists only while a download is genuinely slow — never on an idle page — and
 * it is `transform`-only, so it costs the compositor and nothing else.
 */
function WaitTile({
  href,
  title,
  sub,
  tone,
  delayed = false,
  onNavigate,
  children,
}: {
  href: string;
  title: string;
  sub: string;
  tone: "violet" | "blue";
  /** Stagger the second tile's sheen so the pair breathes instead of blinking in unison. */
  delayed?: boolean;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  const violet = tone === "violet";
  return (
    <Link
      href={href}
      prefetch
      onClick={onNavigate}
      className={[
        /*
          🔴 RESPONSIVE CHROME (owner, 2026-08-16: "this watch reels or view
          wallpaper button that shows on delayed download always compressed
          on small device, fix it to be responsive on all devices").

          Every size below was a single fixed value — a 44px icon disc, a
          28px chevron disc, a 12px gap and 12px padding, all the same from a
          320px phone up through desktop. On the card's narrowest real width
          (`inset-x-3` on a ~320-360px viewport puts this tile around
          150-190px of content column after its own padding), that fixed
          120px of chrome (padding + icon + gaps + chevron) left barely any
          room for the title/subtitle, reading as cramped rather than the
          premium tile the reference asked for. The base (mobile) classes
          are now smaller; `sm:` restores the original larger sizing once
          there is room for it.
        */
        "frenz-alive group relative flex items-center gap-2 overflow-hidden rounded-[1.15rem] p-2.5 text-left sm:gap-3 sm:p-3",
        "ring-1 ring-inset ring-white/25 transition duration-200 hover:-translate-y-px active:scale-[0.985]",
        violet
          ? "bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500 shadow-[0_10px_26px_-12px_rgba(139,92,246,0.85)]"
          : "bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500 shadow-[0_10px_26px_-12px_rgba(59,130,246,0.85)]",
        delayed ? "frenz-alive-2" : "",
      ].join(" ")}
    >
      {/* (2) Wave texture. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_15%_120%,rgba(255,255,255,0.22)_0%,transparent_55%),radial-gradient(100%_70%_at_85%_-20%,rgba(255,255,255,0.18)_0%,transparent_60%)]"
      />
      {/* (3) Glass rim — the lit top edge. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/22 to-transparent"
      />
      {/* The "alive" sweep, unchanged in behaviour from the version the owner
          approved — only the surface under it is new. */}
      <span
        aria-hidden
        className="frenz-alive-sheen pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/35 to-transparent"
      />

      {/* (4) Circular glass disc. */}
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/25 ring-1 ring-inset ring-white/40 backdrop-blur-sm sm:h-11 sm:w-11">
        {children}
      </span>

      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold leading-tight text-white sm:text-[14px]">{title}</span>
        <span className="mt-0.5 block text-[10.5px] leading-snug text-white/85 sm:text-[11px]">{sub}</span>
      </span>

      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-inset ring-white/30 transition group-hover:bg-white/30 sm:h-7 sm:w-7">
        <ChevronRight className="h-3.5 w-3.5 text-white transition-transform group-hover:translate-x-0.5 sm:h-4 sm:w-4" />
      </span>
    </Link>
  );
}

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
  /*
    🔴 FAILURE FIRST (owner, 2026-08-16: "the multiple download sudden stop is
    still happening without notifying if is a daily limit issue").

    This used to be `tasks.find(t => t.status === "completed" || t.status ===
    "failed")` — the FIRST finished task by ARRAY INDEX, not by anything
    meaningful. A batch's files are pushed in order (item 0, 1, 2…), and only
    COMPLETED tasks auto-dismiss after 6s (below) — failed ones sit until the
    visitor deals with them. So for as long as item 0 happened to succeed, its
    "Download complete" card was shown even if item 4 had already failed with
    "Daily download limit reached" sitting right behind it in the list — the
    failure was real and logged, but nothing on screen said so until item 0's
    card auto-dismissed and the finder moved on. That gap reads exactly like
    "it just stopped, no explanation."

    A failure now always wins the card slot the moment nothing is still
    running, whichever task it is and wherever it sits in the array.
  */
  const failedTasks = tasks.filter((t) => t.status === "failed");
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const finished = failedTasks[0] ?? completedTasks[0];
  const task = active ?? finished;
  /*
    "Review video" is now reward-gated (owner, 2026-08-16 GPT spec, §13-15) —
    a second, independent reward context from the download unlock, never
    auto-chained to it (§16). It is entered only from this button's own tap,
    after the download this card belongs to has already fully finished.
  */
  const router = useRouter();
  const onPreviewGranted = useCallback(() => {
    if (!task) return;
    dismissTask(task.id);
    router.push(`/history?review=${encodeURIComponent(task.id)}`);
  }, [task, router]);
  const videoPreview = useRewardFlow("VIDEO_PREVIEW", onPreviewGranted);
  // A mixed outcome ("some saved, some didn't") gets its own line under the
  // headline rather than being silently absorbed into a single file's story.
  const mixedOutcome = !active && failedTasks.length > 0 && completedTasks.length > 0;
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

    Owner, 2026-08-09: "the prompt should only show when the prepare download
    takes more than 5 secs". So this is now `slowPrepare` ALONE — the manager
    raises that flag after 5s of a still-unanswered prepare — where it used to
    also fire on any transfer older than 8 seconds.

    That reads as a narrowing but it is the right line. `preparing` is the state
    with nothing on screen to look at: no bytes, no percentage, no ETA, just a
    spinner while the server extracts and muxes. That is the wait that needs
    both an explanation and somewhere to go. Once bytes are flowing there is a
    progress bar, a size, a speed and a time remaining — the visitor can see it
    working, which is the very thing the prompt was standing in for.

    Nothing is lost for a long transfer: the Hide button sits on EVERY running
    download, so carrying on browsing is always one tap away.

    No timer needed here — `slowPrepare` arrives as a task update, which
    re-renders this component on its own.
  */
  const takingLong = running && task.slowPrepare === true;

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
                    ? failedTasks.length > 1
                      ? `${failedTasks.length} downloads failed`
                      : "Download failed"
                    : activeCount > 1
                      ? `Downloading ${activeCount} items…`
                      : task.status === "preparing"
                        ? task.slowPrepare
                          ? "Still preparing…"
                          : "Preparing your file…"
                        : task.status === "queued"
                          ? (task.attempts ?? 1) > 1
                            ? "Hit a snag — trying again…"
                            : "Queued…"
                          : "Downloading…"}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{task.title || "Your file"}</p>

              {/*
                The slow-prepare explanation is NOT repeated here.

                It used to be: an amber line under the title AND a heading over
                the escape tiles, in different words, both saying the file was
                large. They are raised by the same flag at the same moment, so
                they always appeared together — two explanations of one wait,
                which reads as two problems. The single sentence now lives with
                the tiles (below), where it is also the reason for them.

                A retry still speaks up here, because that one is genuinely
                separate: it is us fixing our own hiccup, not a slow file.
              */}
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
                <>
                  <p className="mt-1 text-xs text-rose-400">{task.error || "Check your connection and retry."}</p>
                  {/* Mixed batch outcome — never let a real failure hide behind
                      the files that DID save (owner: "sudden stop… without
                      notifying"). Named explicitly rather than left implicit
                      in a headline that only mentions the failures. */}
                  {mixedOutcome ? (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {completedTasks.length} saved, {failedTasks.length} didn't.
                    </p>
                  ) : null}
                </>
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
                  <button
                    type="button"
                    onClick={() =>
                      videoPreview.open([
                        { url: task.url, formatId: task.formatId, kind: task.kind, title: task.title },
                      ])
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 px-3 py-2 text-xs font-semibold transition hover:bg-secondary"
                  >
                    <Play className="h-3.5 w-3.5" />{" "}
                    {task.kind === "audio" ? "Review audio" : task.kind === "image" ? "View image" : "Review video"}
                  </button>
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

                Only once the PREPARE has genuinely run long (5s — owner). An
                exit from a download that finishes in two seconds reads as an
                apology for something that was fine, and it would put two links
                under every single transfer.

                Tapping one minimises the card on the way out rather than
                dismissing it: the download keeps running (it always did — the
                manager owns it, not this card), and the bubble stays as proof,
                so nobody has to wonder whether leaving cancelled it. The card
                un-minimises itself the moment the file lands.
              */}
              {takingLong ? (
                /*
                  ── Built to `public/waiting premium button.jpg` (owner, 2026-08-10) ──
                  "how i want the wait buttons, text and texture and color and
                  everything exactly in the image to be in the wait section and
                  buttons."

                  The reference is a frosted panel carrying a titled message and
                  two gradient glass tiles. Everything from it is here: the
                  circular glass badge, the "Almost there!" heading over a
                  two-line explanation, the violet and blue gradient tiles with
                  their wave texture, the circular glass icon discs with white
                  glyphs, the two-line subtitles and the round chevron affordance.

                  🔴 ONE deviation, and it is forced by width, not preference.
                  The reference places the two tiles SIDE BY SIDE, and it is a
                  wide desktop mock — each tile is ~700px there. This panel lives
                  inside the floating download card, which is `max-w-md` on a
                  phone and `lg:w-96` (384px) on a desktop, so two columns give
                  each tile about 172px. The reference tile's own anatomy — a
                  56px icon disc, a title, a two-line subtitle and a 32px chevron
                  in a row — cannot fit 172px; it would have to lose the subtitle
                  and shrink the discs, which is losing the texture, the text and
                  the proportions the instruction was specifically about.

                  Stacked full-width tiles reproduce each tile EXACTLY as drawn.
                  The only thing that changes is how the two relate to each
                  other, which is the one part a 384px container genuinely cannot
                  honour. Widening the card was the alternative and it is worse:
                  this thing floats over live content on every surface in the app.
                */
                <div className="frenz-wait mt-3 overflow-hidden rounded-[1.35rem] bg-gradient-to-b from-white/85 to-slate-50/70 p-3 ring-1 ring-inset ring-white/70 backdrop-blur-xl dark:from-white/[0.07] dark:to-white/[0.03] dark:ring-white/10">
                  {/* Header — glass badge + heading + explanation, per the reference. */}
                  <div className="flex items-start gap-2.5">
                    <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 shadow-[0_2px_8px_rgba(15,23,42,0.10)] ring-1 ring-inset ring-white dark:bg-white/10 dark:ring-white/20">
                      {/* The reference's small violet spark. It pulses rather
                          than spins — this panel is about waiting calmly, and a
                          spinner is already doing the "working" job above. */}
                      <Sparkles className="frenz-wait-spark h-4 w-4 text-violet-600 dark:text-violet-300" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-extrabold leading-tight tracking-[-0.01em] text-slate-900 dark:text-white">
                        Almost there!
                      </span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-slate-500 dark:text-white/60">
                        {WAIT_COPY}
                      </span>
                    </span>
                  </div>
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
                  {/*
                    The two gradient tiles. Stacked — see the note above for why
                    the reference's side-by-side pair cannot survive a 384px card
                    without losing the tile design itself.
                  */}
                  <div className="mt-2.5 grid gap-2">
                    <WaitTile
                      href="/wallpapers"
                      title="Wallpapers"
                      sub="Explore beautiful HD wallpapers"
                      tone="violet"
                      onNavigate={() => setMinimised(true)}
                    >
                      <ImageIcon className="h-[18px] w-[18px] text-white" strokeWidth={2.25} />
                    </WaitTile>
                    <WaitTile
                      href="/reels"
                      title="Watch reels"
                      sub="Discover trending videos and more"
                      tone="blue"
                      delayed
                      onNavigate={() => setMinimised(true)}
                    >
                      {/* The reference draws a WHITE rounded plate with the play
                          triangle knocked out in the tile's own colour — not a
                          white outline glyph. Rebuilt as exactly that, so the
                          reels disc reads as a video badge rather than as a
                          second image icon. */}
                      <span className="flex h-[18px] w-[22px] items-center justify-center rounded-[5px] bg-white">
                        <Play className="h-2.5 w-2.5 fill-blue-600 text-blue-600" />
                      </span>
                    </WaitTile>
                  </div>
                </div>
              ) : null}
            </div>

            {/*
              ── 🔴 THE TWO CONTROLS MEAN OPPOSITE THINGS (owner, 2026-08-11) ──
              "differentiate the X and hide button and separate them so a user
              with the intent of pressing hide wont mistake it for X, and change
              the hide text to minimize, and make the X button to be bold and 3d
              with clear description separated from the minimize button."

              One of these keeps your download and the other CANCELS it, and they
              were an unlabelled 16px glyph sitting a few pixels from a small
              pill. A mis-tap costs the whole transfer, so the two are now
              separated on every axis a person actually reads:

               • WORDS. "Minimize" says what it does; "Hide" reads like
                 dismissal, which is the very thing it is not. The X gains
                 "Cancel"/"Close" beside it, so neither control is a bare glyph.
               • WEIGHT. The X is a raised, bordered disc with a shadow and a
                 thick stroke — the "bold and 3d" asked for — while Minimize
                 stays a flat tinted pill. Destructive reads as heavier.
               • COLOUR. Destructive is red-tinted; the safe option keeps the
                 brand blue.
               • DISTANCE. A `mt-3` gap and a hairline divider between them, so
                 they are no longer two items in one cluster.

              Order is deliberate too: Minimize sits FIRST, because it is what
              most people reaching for this corner actually want.
            */}
            <div className="flex shrink-0 flex-col items-stretch gap-1">
              {running ? (
                <button
                  type="button"
                  aria-label="Minimize — keep downloading in the background"
                  onClick={() => {
                    haptic("light");
                    setMinimised(true);
                  }}
                  className="inline-flex items-center justify-center gap-1 rounded-full bg-[#2563FF]/10 px-2.5 py-1.5 text-[10px] font-bold text-[#2563FF] ring-1 ring-inset ring-[#2563FF]/25 transition hover:bg-[#2563FF]/20 active:scale-95 dark:text-blue-300"
                >
                  <Minus className="h-3 w-3" strokeWidth={3} />
                  Minimize
                </button>
              ) : null}

              {/* The divider is the separation made literal — without it the two
                  still read as one control group however far apart they sit. */}
              {running ? <span aria-hidden className="my-1 h-px w-full bg-border/70" /> : null}

              <button
                type="button"
                aria-label={running ? "Cancel download — this stops the transfer" : "Dismiss"}
                title={running ? "Cancel download" : "Dismiss"}
                onClick={() => (running ? cancelDownload(task.id) : dismissTask(task.id))}
                className={cn(
                  "inline-flex items-center justify-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-bold transition active:scale-95 active:shadow-none",
                  // The "3d": a real border, an inset highlight and a drop shadow,
                  // so it sits ABOVE the card rather than on it.
                  "border border-rose-500/40 bg-rose-500/10 text-rose-600 shadow-[0_2px_0_0_rgba(225,29,72,0.35),inset_0_1px_0_0_rgba(255,255,255,0.5)] hover:bg-rose-500/20 active:translate-y-[2px] dark:text-rose-300 dark:shadow-[0_2px_0_0_rgba(225,29,72,0.5),inset_0_1px_0_0_rgba(255,255,255,0.12)]",
                )}
              >
                <X className="h-3 w-3" strokeWidth={3.2} />
                {running ? "Cancel" : "Close"}
              </button>
            </div>
          </div>
      </div>
      <RewardConsentSheet {...videoPreview.sheetProps} />
    </div>
  );
}
