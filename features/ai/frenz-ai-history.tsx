"use client";

import {
  AlertTriangle,
  AudioLines,
  Ban,
  CheckCircle2,
  Clapperboard,
  ImagePlay,
  LayoutGrid,
  Loader2,
  Mic,
  MoreVertical,
  PersonStanding,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Video,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import { aiButtonClass } from "@/features/ai/design/ai-button";
import { useAiHistory } from "@/features/ai/use-ai-history";
import {
  AI_HISTORY_EMPTY_COPY,
  AI_HISTORY_FILTERS,
  AI_HISTORY_FILTER_LABELS,
  historyChip,
  historyTitleFor,
  hoursUntilExpiry,
  resultAvailability,
  type AiHistoryTone,
} from "@/lib/ai/history";
import { REPLACEMENT_MODES, replacementModeLabel, type ReplacementMode } from "@/lib/ai/character-replace/modes";
import { isActiveStatus, type AiJobView } from "@/lib/ai/jobs";
import { formatRelative } from "@/lib/i18n/format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { haptic } from "@/lib/motion/haptics";
import { cn, formatDuration } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the history section
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "if a job finishes while I'm outside the page or the app,
 * it just disappears. I want a section on the AI page showing completed,
 * cancelled and all past jobs, so I can come back and still see the video that
 * was made."
 *
 * ── 🔴 THE VIDEO WAS NEVER LOST. IT WAS UNREACHABLE ─────────────────────────
 *
 * Every finished job has been sitting in `ai_jobs` with its file in private
 * storage the whole time, and `GET /api/ai/jobs` has listed them since Part 2.
 * What did not exist was any surface that asked. `useAiCleanJob` restores
 * exactly ONE job and only an ACTIVE one — deliberately, because a workspace
 * that reopened last week's result instead of an empty picker would be wrong —
 * so a job that finished while the app was closed had nowhere to appear.
 *
 * That is why this is a new section rather than a change to the workspace: the
 * two questions ("what am I doing now?" and "what have I made?") want opposite
 * answers from the same table.
 *
 * ── The whole list is metadata. Not one video is loaded. ────────────────────
 *
 * No posters, no `preload`, no signed urls. A TILE is a gradient plate and a
 * chip; the file
 * is only ever signed for when somebody taps Play, and the player itself is
 * `next/dynamic` so its markup, the compare canvases and the sheet's gesture
 * code stay off this page until they are needed. A history list that decoded a
 * frame per row to draw thumbnails would warm the phone of somebody who came
 * here to press one button, which is the rule this feature is held to
 * everywhere else — and it is why these tiles are brand plates rather than
 * posters, even though the download gallery beside them shows real frames.
 *
 * ── Honest about expiry ─────────────────────────────────────────────────────
 *
 * The retention sweep writes `expired` and deletes both objects hourly (Part 7,
 * lib/ai/retention.ts). A tile is still judged by the TIMESTAMP as well as the
 * status, because the sweep runs on the hour and there is always a window where
 * a file is past its promise and the row has not caught up — the member should
 * be told the truth in that window rather than offered a dead link.
 */

/*
  The player carries a video element, the before/after canvases and the shared
  glass sheet (which pulls framer-motion). None of that belongs on a welcome
  page that most visits never tap through — see the standing rule about
  code-splitting heavy widgets off first load.
*/
const FrenzAIHistoryPlayer = dynamic(
  () => import("@/features/ai/frenz-ai-history-player").then((m) => m.FrenzAIHistoryPlayer),
  { ssr: false },
);

/* ── kinds, for the reference's filter pills (2026-10-06) ───────────────── */
type HistoryKind = "video" | "audio";
const HISTORY_KINDS: readonly HistoryKind[] = ["video", "audio"];
const HISTORY_KIND_LABEL: Record<HistoryKind, string> = { video: "Videos", audio: "Audio" };
const HISTORY_KIND_ICON: Record<HistoryKind, LucideIcon> = { video: Video, audio: AudioLines };
/** Audio is what Text to Audio and Voice Cloning make; everything else here is a video. */
function historyKind(feature: AiJobView["feature"]): HistoryKind {
  return feature === "ai_text_to_audio" || feature === "ai_voice_clone" ? "audio" : "video";
}
const HISTORY_TOOL_ICON: Partial<Record<AiJobView["feature"], LucideIcon>> = {
  ai_text_to_video: Sparkles,
  ai_image_to_video: ImagePlay,
  ai_lip_sync: Clapperboard,
  ai_text_to_audio: AudioLines,
  ai_voice_clone: Mic,
  ai_character_replace: PersonStanding,
};

export function FrenzAIHistory({
  className,
  showHeading = true,
  groupByDay = false,
  resultHref = (id) => `/studio/ai/character-replace/result/${encodeURIComponent(id)}`,
  batchHref = (id) => `/studio/ai/character-replace/create?batch=${encodeURIComponent(id)}`,
}: {
  className?: string;
  /**
   * Part 7 §19: where a Character Replace tile goes — the result route, which
   * renders the right screen for ANY status (ready → Video Ready, running →
   * the tracker, failed → refund + Try again) and checks ownership on the
   * server. AI Clean rows keep the inline player: their result screen is
   * the player.
   */
  resultHref?: (jobId: string) => string;
  /** 0166: where a tile of a multi-video session still in flight goes — the session's board, every video at once. */
  batchHref?: (batchId: string) => string;
  /**
   * Break the list into Today / Yesterday / This week / Last week / Earlier.
   *
   * 🔴 The SAME five buckets and the same boundaries as the download history
   * gallery (features/history/media-gallery.tsx), because the owner asked for
   * the two pages to be structured alike — and because a product that calls
   * the same seven days "This week" on one screen and something else on
   * another is a product that was assembled rather than designed.
   *
   * Off for the strip on the welcome page, where four rows need no dividers.
   */
  groupByDay?: boolean;
  /**
   * False when this list IS the page and the page already has an H1.
   * Two headings saying "Your videos" on one screen is the duplicate the
   * dedicated history route would otherwise introduce.
   */
  showHeading?: boolean;
}) {
  const history = useAiHistory("all");
  const [openJob, setOpenJob] = useState<AiJobView | null>(null);

  /*
    One clock for the whole list, ticking a minute at a time.

    Every row asks two questions of the present — is this file still within its
    window, and how long ago was it made — and `Date.now()` inside a render is
    a value React cannot invalidate. A row rendered at 23:59 on the last day of
    a video's life would keep offering Play until something unrelated caused a
    re-render. A minute is far finer than the three-day window needs and costs
    one state write per minute for the section.
  */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  /*
    🔴 The open sheet follows the LIST, not a snapshot.

    `openJob` is a value copied out of the list when the row was tapped. The
    poll behind this section replaces rows as jobs finish, so without this the
    sheet would keep showing the state the row had at the moment of the tap —
    including, for a job that finished while the sheet was open, "still
    working". Re-reading it by id each render is what keeps the two in step.
  */
  /*
    Part 7 §17: a feature filter, drawn only when the list holds more than one
    tool's rows (a member with only Character Replace videos gets no chip
    row to puzzle over). Client-side over the loaded page — the status tabs
    stay the server's.
  */
  /*
    Redesign 2026-10-06 (owner's AI History reference): the filter is by KIND
    — All · Videos · Audio — drawn only for kinds the list holds. There is no
    image tool, so there is no Images pill (an always-empty tab is a claim).
    Client-side over the on-device list.
  */
  const kinds = useMemo(() => Array.from(new Set(history.jobs.map((j) => historyKind(j.feature)))), [history.jobs]);
  const [kindFilter, setKindFilter] = useState<"all" | HistoryKind>("all");
  /*
    2026-09-20 (the replacement-scope brief §18): a second chip row, by
    SCOPE — All · Face Only · Face + Head · Upper Body · Full Character —
    drawn only for scopes the loaded list actually holds. Client-side over
    the page, like the tool filter.
  */
  const modes = useMemo(() => Array.from(new Set(history.jobs.map((j) => j.characterReplace?.mode).filter((m): m is ReplacementMode => !!m))), [history.jobs]);
  const [modeFilter, setModeFilter] = useState<"all" | ReplacementMode>("all");
  const visibleJobs = useMemo(
    () => history.jobs.filter((j) => (kindFilter === "all" || historyKind(j.feature) === kindFilter) && (modeFilter === "all" || j.characterReplace?.mode === modeFilter)),
    [kindFilter, modeFilter, history.jobs],
  );

  const live = openJob ? (history.jobs.find((j) => j.id === openJob.id) ?? openJob) : null;

  /*
    The buckets. Boundaries copied from the download gallery deliberately —
    midnight, then 24h, then 6 days, then 13. Empty ones are dropped, so a
    visitor who cleaned nothing yesterday never sees an empty "Yesterday".
  */
  const sections = useMemo(() => {
    if (!groupByDay) return null;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const today = midnight.getTime();
    const yesterday = today - 86_400_000;
    const week = today - 6 * 86_400_000;
    const lastWeek = today - 13 * 86_400_000;

    const buckets: { key: string; label: string; items: AiJobView[] }[] = [
      { key: "today", label: "Today", items: [] },
      { key: "yesterday", label: "Yesterday", items: [] },
      { key: "week", label: "This week", items: [] },
      { key: "lastweek", label: "Last week", items: [] },
      { key: "earlier", label: "Earlier", items: [] },
    ];
    for (const job of visibleJobs) {
      const t = Date.parse(job.createdAt);
      // An unparseable timestamp lands in Earlier rather than crashing a bucket
      // index — the row is still the member's and still worth showing.
      const at = Number.isFinite(t) ? t : 0;
      const i = at >= today ? 0 : at >= yesterday ? 1 : at >= week ? 2 : at >= lastWeek ? 3 : 4;
      buckets[i]!.items.push(job);
    }
    return buckets.filter((b) => b.items.length > 0);
  }, [groupByDay, visibleJobs]);

  const close = useCallback(() => setOpenJob(null), []);

  const router = useRouter();
  const open = (job: AiJobView) => {
    haptic("selection");
    if (job.feature === "ai_character_replace") {
      // 0166: a video of a session still running opens the whole session; a finished one opens its own result.
      router.push(job.batch && isActiveStatus(job.status) ? batchHref(job.batch.id) : resultHref(job.id));
      return;
    }
    if (job.feature === "ai_lip_sync") {
      // Lip Sync Pro (2026-09-21): its own result route, the same rules
      router.push(resultHref(job.id).replace("/character-replace/result/", "/lip-sync/result/"));
      return;
    }
    if (job.feature === "ai_voice_clone") {
      // Voice Cloning (2026-09-27): the workspace shows this voice and the library beneath it
      router.push(resultHref(job.id).replace(/\/character-replace\/result\/.*$/, `/voice-cloning?job=${encodeURIComponent(job.id)}`));
      return;
    }
    if (job.feature === "ai_text_to_audio") {
      // Text to Audio (2026-09-21): the workspace shows this generation (its player, its library row)
      router.push(resultHref(job.id).replace(/\/character-replace\/result\/.*$/, `/text-to-audio?job=${encodeURIComponent(job.id)}`));
      return;
    }
    setOpenJob(job);
  };

  return (
    <section className={className} aria-labelledby="ai-history-heading">
      {/*
        ── 🔴 A SECTION, NOT A FOOTNOTE (owner, 2026-09-09) ──────────────────

        "Put it where it will be visible more and look professional."

        A 17px heading over a bare list read as an appendix to the page above
        it. It now opens on its own rule and carries a count, which is what
        makes it scan as a place rather than a leftover — and the count is the
        one thing that tells somebody at a glance whether there is anything
        here worth scrolling to.
      */}
      {showHeading ? <div className="mb-4 h-px w-full bg-border/70" aria-hidden /> : null}

      {/*
        🔴 When the page owns the heading, the H2 goes SCREEN-READER ONLY
        rather than the whole row — the Refresh control still has to be there.
        Hiding the row would have taken it with it, which is the kind of thing a
        visual check catches and a diff does not.
      */}
      <div className="flex items-center justify-between gap-3">
        <h2
          id="ai-history-heading"
          className={cn(
            "flex items-baseline gap-2 text-[1.2rem] font-bold tracking-[-0.02em]",
            !showHeading && "sr-only",
          )}
        >
          Your videos
          {/*
            Only once something is loaded, and never a "0" — an empty state
            already says there is nothing, and a zero beside a heading reads as
            a failure rather than as a fact.
          */}
          {history.loaded && history.jobs.length > 0 ? (
            <span className="text-[13px] font-semibold tabular-nums text-muted-foreground">
              {history.jobs.length}
              {history.hasMore ? "+" : ""}
            </span>
          ) : null}
        </h2>
        {/*
          A quiet refresh. The list polls itself while a job is running, so this
          is for the other case: somebody who has been on the page a while and
          wants to be sure, without reloading the whole app.
        */}
        <button
          type="button"
          onClick={() => {
            haptic("selection");
            history.refresh();
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RotateCcw className={cn("h-3.5 w-3.5", history.refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden />
          Refresh
        </button>
      </div>

      {kinds.length > 1 ? (
        <div role="tablist" aria-label="Filter by kind" className="mt-3 flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          {(["all", ...HISTORY_KINDS] as const)
            .filter((id) => id === "all" || kinds.includes(id))
            .map((id) => {
              const on = kindFilter === id;
              const Icon = id === "all" ? LayoutGrid : HISTORY_KIND_ICON[id];
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => {
                    haptic("selection");
                    setKindFilter(id);
                  }}
                  className={cn(
                    "inline-flex min-h-[2.75rem] shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition active:scale-[0.97]",
                    on
                      ? "bg-gradient-to-r from-[#4f6cf0] via-[#5f4fee] to-[#8650ea] text-white shadow-[0_8px_18px_-10px_rgba(79,70,229,0.75)]"
                      : "bg-card text-foreground/75 ring-1 ring-inset ring-black/[0.08] [@media(hover:hover)]:hover:ring-indigo-300/60",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {id === "all" ? "All" : HISTORY_KIND_LABEL[id]}
                </button>
              );
            })}
        </div>
      ) : null}

      {modes.length > 1 && kindFilter !== "audio" ? (
        <div role="tablist" aria-label="Filter by replacement type" className="mt-2 flex flex-wrap gap-1.5">
          {(["all", ...REPLACEMENT_MODES] as const)
            .filter((id) => id === "all" || modes.includes(id))
            .map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={modeFilter === id}
                onClick={() => setModeFilter(id)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-[12px] font-semibold transition",
                  modeFilter === id ? "bg-foreground text-background" : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                {id === "all" ? "All types" : replacementModeLabel(id)}
              </button>
            ))}
        </div>
      ) : null}

      <div className="mt-3">
        {history.loading ? (
          <HistorySkeleton />
        ) : history.error ? (
          <p role="alert" className="rounded-2xl border border-border/60 bg-card/95 px-4 py-6 text-center text-sm text-muted-foreground">
            {history.error}
          </p>
        ) : history.jobs.length === 0 ? (
          <EmptyState filter={history.filter} />
        ) : (
          /*
            ── 🔴 SAME STRUCTURE AS DOWNLOAD HISTORY, DIFFERENT SKIN ──────────

            Owner, 2026-09-09: "structure the AI history, card, and everything
            exactly, the gesture and all from the download history page to the
            AI history page but they should not carry exactly the same design
            they should be differentiated."

            So the SHAPE is borrowed — the same five day buckets on the same
            boundaries, a sticky-feeling section label, one tappable card per
            item — and the SKIN is not. Download history is a square-thumbnail
            grid of media you already own; this is a status list of work that
            was done to your video, so it stays a full-width row with a state
            chip, a subtitle that explains itself, and no poster at all.

            Copying the visual treatment would also have cost what that grid
            costs: a decoded image per tile. This list still loads no video.
          */
          sections ? (
            <div className="flex flex-col gap-5">
              {sections.map((section) => (
                <section key={section.key} aria-label={section.label}>
                  <h3 className="mb-2.5 flex items-center gap-2 px-1 text-[17px] font-bold tracking-[-0.015em]">
                    {section.label}
                    <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-indigo-600 ring-1 ring-inset ring-indigo-100">
                      {section.items.length}
                    </span>
                  </h3>
                  <div className={HISTORY_GRID}>
                    {section.items.map((job) => (
                      <HistoryTile key={job.id} job={job} now={now} onOpen={() => open(job)} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className={HISTORY_GRID}>
              {visibleJobs.map((job) => (
                <HistoryTile key={job.id} job={job} now={now} onOpen={() => open(job)} />
              ))}
            </div>
          )
        )}
      </div>

      {history.hasMore ? (
        <button
          type="button"
          onClick={history.loadMore}
          disabled={history.loadingMore}
          className={aiButtonClass({ variant: "secondary", block: true, className: "ai-btn--round mt-3" })}
        >
          {history.loadingMore ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : null}
          {history.loadingMore ? "Loading…" : "Show more"}
        </button>
      ) : null}

      {live ? <FrenzAIHistoryPlayer job={live} now={now} onClose={close} /> : null}
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * ── 🔴 TWO COLUMNS ON A PHONE. THE SAME NUMBER THE DOWNLOAD GALLERY USES ────
 *
 * This was three, and three is the reason the two pages still did not look
 * alike in the owner's screenshots. `media-gallery.tsx` carries the note that
 * settled it there in 2026-08: at three columns a tile is a ~110px thumbnail
 * and "you cannot tell two clips of the same creator apart", so two is the
 * width at which a thumbnail is actually a preview.
 *
 * That argument is not weaker here, it is stronger: a cleaned video differs
 * from its original in a caption-sized patch, and at 110px that patch is a few
 * pixels. Two columns is the width at which the tile shows the thing the
 * feature did.
 */
/* 2026-10-06: a LIST of media rows (the owner's AI History reference) — thumbnail left, the facts right. */
const HISTORY_GRID = "flex flex-col gap-2.5";

const TONE_CLASS: Record<AiHistoryTone, string> = {
  active: "bg-primary/12 text-primary ring-primary/25",
  good: "bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400",
  muted: "bg-muted text-muted-foreground ring-border/60",
  warn: "bg-amber-500/12 text-amber-600 ring-amber-500/25 dark:text-amber-400",
};

/**
 * One video, as a TILE.
 *
 * ── 🔴 THE DOWNLOAD HISTORY'S STRUCTURE, NOT ITS SKIN ──────────────────────
 *
 * Owner, 2026-09-09: "I just checked, the AI history is still the same how it
 * was — I said it should be like the download history."
 *
 * They were right and my first answer was half of one: I added day sections but
 * kept a list of full-width rows, so it still read as a settings list rather
 * than a library. The download history is a GRID OF SQUARE TILES (
 * `features/history/media-gallery.tsx` — `aspect-square`, `rounded-2xl`, a
 * status chip bottom-left, three columns on a phone), and that shape is the
 * thing being asked for: a wall of your work, scannable at a glance.
 *
 * So the STRUCTURE is now the same — square tiles, the same grid rhythm, the
 * same corner treatment, the same bottom-left chip, the same tap-to-open.
 *
 * ── 🔴 AND THEN IT STILL DID NOT LOOK ALIKE (owner, 2026-09-09) ────────────
 *
 * A second screenshot, both pages side by side: "they look very different."
 *
 * They did, and the reason was not the layout — by then both were grids of
 * square rounded tiles in day sections. It was that a download tile is a
 * PHOTOGRAPH OF YOUR VIDEO and this one was a coloured plate. On one page you
 * recognise your clip; on the other you read a filename. Nothing about corner
 * radius or column count closes that gap, because the missing thing is an
 * image.
 *
 * The old note here defended the plate on cost, and that argument was sound as
 * far as it went — a signed URL and a decoded frame per tile, on a list
 * somebody opens to press one button, is exactly the phone-warming this feature
 * refuses everywhere else. What it missed is that those were not the only two
 * options. The WORKER has the finished file on local disk and ffmpeg in its
 * hand; it now cuts one ~25 KB JPEG there (migration 0147), on a machine that
 * has just decoded the whole video anyway. The phone downloads a picture. It
 * still decodes no video, and the promise is intact.
 *
 * ── The skin is still deliberately NOT the same ────────────────────────────
 *
 * "they should not carry exactly the same design they should be
 * differentiated." A download tile wears its PLATFORM in the corner — where it
 * came from is the fact that matters about a file you saved. An AI tile wears
 * the Frenz mark and a Before / after pill: what matters here is what was DONE
 * to it. The scrim is indigo rather than neutral black, and a job with no video
 * to show still falls back to the brand plate, which is now the exception
 * rather than every tile.
 */
function HistoryTile({ job, now, onOpen }: { job: AiJobView; now: number; onOpen: () => void }) {
  const chip = historyChip(job, now);
  const availability = resultAvailability(job, now);
  const playable = availability === "ready";
  const active = isActiveStatus(job.status);

  /*
    🔴 A TILE IS A BUTTON ONLY WHEN IT DOES SOMETHING.

    A cancelled job has no video, so rendering its tile as a `<button>` would
    put a focusable, pressable-looking control on the page that answers a tap
    with nothing. Playable tiles are buttons; the rest are plain `div`s that say
    why in their own caption.
  */
  /*
    Part 7 §19: a Character Replace tile is a button in EVERY state — ready
    opens Video Ready, running opens the tracker, failed opens the refund and
    Try again — because the result route draws all of them. Other tools keep
    the old rule: a button only when there is a video to play.
  */
  const opens = playable || job.feature === "ai_character_replace";
  const Tag = opens ? "button" : "div";
  const title = job.source.name ?? historyTitleFor(job.feature);

  const kind = historyKind(job.feature);
  const ToolIcon = HISTORY_TOOL_ICON[job.feature] ?? Sparkles;
  const seconds = job.result.durationSeconds ?? (job.textToAudio?.durationMs ? job.textToAudio.durationMs / 1000 : null) ?? job.source.durationSeconds;

  return (
    /*
      ── A MEDIA ROW (owner's AI History reference, 2026-10-06) ──────────────
      Thumbnail on the left with its play disc and length; on the right the
      tool chip, the title, when, and the state as a pill; ⋮ opens the same
      sheet a tap on the picture does. White card, hairline, a soft float.

      `opens` is unchanged: a Character Replace row is a door in every state,
      every other tool's row only when there is something to play.
    */
    <article
      className={cn(
        "group relative flex gap-3 rounded-[1.375rem] bg-card p-2.5 pr-10 ring-1 ring-inset ring-black/[0.07] shadow-[0_8px_24px_-20px_rgba(30,40,90,0.45)]",
        opens && "transition active:scale-[0.99]",
      )}
    >
      <Tag
        {...(opens ? { type: "button" as const, onClick: onOpen } : {})}
        aria-label={opens ? (playable ? `Open ${title}` : active ? `${title} — processing` : `${title} — ${chip.label}`) : undefined}
        className={cn(
          "relative block aspect-[16/10] w-[42%] max-w-[13rem] shrink-0 overflow-hidden rounded-[0.95rem] bg-black/40 text-left",
          opens && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
        )}
      >
        <HistoryPoster job={job} playable={playable} active={active} audio={kind === "audio"} />
        {playable ? (
          <span className="absolute bottom-1.5 left-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">
            <Play className="ml-0.5 h-3.5 w-3.5 fill-white" aria-hidden />
          </span>
        ) : null}
        {seconds ? (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-white">
            {formatDuration(seconds)}
          </span>
        ) : null}
        {/* 0166: the video's place in its multi-video session */}
        {job.batch ? (
          <span aria-hidden className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
            {job.batch.index}
            {job.batch.size ? `/${job.batch.size}` : ""}
          </span>
        ) : null}
      </Tag>

      <div className="min-w-0 flex-1 py-0.5">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-indigo-600">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-indigo-50 ring-1 ring-inset ring-indigo-100">
            <ToolIcon className="h-3 w-3" aria-hidden />
          </span>
          <span className="truncate">{historyTitleFor(job.feature)}</span>
        </span>
        {/*
          🔴 The member's own filename, as they typed it — no `uppercase`, no
          truncated extension. `line-clamp-1` ALONE, never with `block`.
        */}
        <p className="mt-1 line-clamp-1 text-[14.5px] font-semibold tracking-[-0.01em]">{title}</p>
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
          <TileCaption job={job} availability={availability} now={now} />
        </p>
        <span
          className={cn(
            "mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
            chip.tone === "good" ? "bg-indigo-50 text-indigo-700 ring-indigo-200" : TONE_CLASS[chip.tone],
          )}
        >
          {chip.tone === "good" ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : active ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          {chip.label}
        </span>
      </div>

      {opens ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`More for ${title}`}
          className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <MoreVertical className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </article>
  );
}


/**
 * The picture on the tile — or the plate, when there is no picture.
 *
 * ── 🔴 A STABLE URL, NOT A SIGNED ONE ───────────────────────────────────────
 *
 * `/api/ai/jobs/<id>/poster` is a path the browser can build from the id it
 * already has, and it never changes. That is the whole reason the route serves
 * bytes instead of redirecting to a signed URL: this list POLLS ITSELF while a
 * job runs, so a signed `src` would be a new URL every few seconds and every
 * tile would re-download a picture the browser already had. A fixed path is
 * fetched once and cached for a day.
 *
 * `hasPoster` gates it, so a job that has no frame never issues a request that
 * can only 404 — a wall of failed requests is how a list gets slow.
 */
function HistoryPoster({
  job,
  playable,
  active,
  audio = false,
}: {
  job: AiJobView;
  playable: boolean;
  active: boolean;
  /** An audio row: the reference's gradient plate with a waveform, never a request. */
  audio?: boolean;
}) {
  /*
    Reset synchronously when the id changes rather than in an effect, so a
    recycled tile never paints one stale frame of the previous job's poster.
    Same pattern as `SmartThumb` and `FeedImage`.
  */
  const [broken, setBroken] = useState(false);
  const [lastId, setLastId] = useState(job.id);
  if (job.id !== lastId) {
    setLastId(job.id);
    setBroken(false);
  }

  if (audio) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#4f6cf0] via-[#6d5cf0] to-[#a77bf3] text-white/95">
        {active ? <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" aria-hidden /> : <AudioLines className="h-8 w-8" aria-hidden />}
      </span>
    );
  }

  if (job.result.hasPoster && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a private-bucket proxy route; next/image cannot sign for it
      <img
        src={`/api/ai/jobs/${job.id}/poster`}
        alt=""
        loading="lazy"
        /*
          `decoding="async"` alongside the lazy load. They solve different
          halves: `lazy` defers the FETCH, but decoding still lands on the main
          thread by default, so a screen of posters arriving together blocks
          interaction while each is decoded. That is the jank that reads as "the
          page takes a moment to open".
        */
        decoding="async"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
      />
    );
  }

  /*
    No poster: a job still running, one that never produced a video, or a row
    from before migration 0147. The brand plate, which used to be every tile and
    is now the exception — tinted by state, because a plate that looked the same
    for "working" and "cancelled" would be the only thing on the tile saying
    nothing.
  */
  return (
    <span
      className={cn(
        "flex h-full w-full items-center justify-center",
        playable
          ? "bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500 text-white/95"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {active ? (
        <Loader2 className="h-7 w-7 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : job.status === "cancelled" ? (
        <Ban className="h-7 w-7" aria-hidden />
      ) : job.status === "failed" ? (
        <AlertTriangle className="h-7 w-7" aria-hidden />
      ) : playable ? (
        <Play className="h-8 w-8 fill-current" aria-hidden />
      ) : (
        <Trash2 className="h-7 w-7" aria-hidden />
      )}
    </span>
  );
}

/** One line per tile, and never the same one for two different situations. */
function TileCaption({
  job,
  availability,
  now,
}: {
  job: AiJobView;
  availability: ReturnType<typeof resultAvailability>;
  now: number;
}) {
  const when = formatRelative(job.createdAt, undefined, new Date(now));

  const cr = job.characterReplace;
  if (availability === "pending") return <>Processing… · keeps going if you leave</>;
  if (availability === "expired") return <>Expired · {when}</>;
  if (job.status === "cancelled") return <>Canceled · {when}</>;
  /* Part 7 §18: "Refunded ✓" only when the ledger confirmed it (the list route reads the ledger for failed rows). */
  if (job.status === "failed") return <>Failed{cr?.refunded ? " · Refunded ✓" : cr?.refundPending ? " · Refund pending" : ""} · {when}</>;
  /* Part 9 §24: a Character Replace tile names its length and quality, then when and how long it stays. */
  const facts = cr ? [job.result.durationSeconds ? `${(Math.round(job.result.durationSeconds * 10) / 10).toFixed(1)} s` : null, qualityWord(cr.quality)].filter(Boolean).join(" · ") : "";
  if (availability === "ready" && cr?.savedAt) return <>Saved{facts ? ` · ${facts}` : ""} · {when}</>;
  if (availability === "ready" && facts) {
    const hours = hoursUntilExpiry(job, now);
    const days = hours === null ? null : Math.floor(hours / 24);
    return (
      <>
        {facts} · {when}
        {hours === null ? "" : days && days >= 1 ? ` · ${days}d left` : hours >= 1 ? ` · ${Math.floor(hours)}h left` : " · expiring"}
      </>
    );
  }
  if (availability === "ready") {
    const hours = hoursUntilExpiry(job, now);
    const days = hours === null ? null : Math.floor(hours / 24);
    return (
      <>
        {when}
        {hours === null
          ? ""
          : days && days >= 1
            ? ` · ${days} ${days === 1 ? "day" : "days"} left`
            : ` · ${hours}h left`}
      </>
    );
  }
  return <>{when}</>;
}

function EmptyState({ filter }: { filter: keyof typeof AI_HISTORY_EMPTY_COPY }) {
  const copy = AI_HISTORY_EMPTY_COPY[filter];
  return (
    <div className="rounded-[1.375rem] border-[1.5px] border-dashed border-indigo-300/70 bg-indigo-50/30 px-6 py-10 text-center">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <Sparkles className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-semibold">{copy.title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">{copy.body}</p>
      {/* Part 9 §35: useful, not decorative — the door to the first video, from the empty list itself */}
      {filter === "all" ? (
        <Link href="/studio/ai/character-replace" className={aiButtonClass({ className: "mt-5" })}>
          <Sparkles className="h-4 w-4" aria-hidden />
          Explore AI tools
        </Link>
      ) : null}
    </div>
  );
}

/** "720p" stays "720p"; a mode tier reads as its name. */
function qualityWord(q: string): string {
  return q === "standard" ? "Standard" : q === "high" ? "High" : q === "ultra" ? "Ultra" : q;
}

/** The grid's own shape while the first page loads — never a spinner. */
function HistorySkeleton() {
  return (
    <div className={cn(HISTORY_GRID)} aria-hidden>
      {/*
        🔴 The caption is INSIDE the tile now, so the skeleton is a bare square.
        A skeleton that keeps drawing two grey bars under each tile promises a
        layout the real list no longer has, and the swap from one to the other
        is a visible jump on every load.
      */}
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 rounded-[1.375rem] p-2.5 ring-1 ring-inset ring-black/[0.07]">
          <div className="aspect-[16/10] w-[42%] max-w-[13rem] shrink-0 animate-pulse rounded-[0.95rem] bg-secondary motion-reduce:animate-none" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 w-24 animate-pulse rounded-full bg-secondary motion-reduce:animate-none" />
            <div className="h-4 w-36 animate-pulse rounded-full bg-secondary motion-reduce:animate-none" />
            <div className="h-3 w-28 animate-pulse rounded-full bg-secondary motion-reduce:animate-none" />
          </div>
        </div>
      ))}
    </div>
  );
}

