"use client";

import {
  AlertTriangle,
  Ban,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAiHistory } from "@/features/ai/use-ai-history";
import {
  AI_HISTORY_EMPTY_COPY,
  AI_HISTORY_FILTERS,
  AI_HISTORY_FILTER_LABELS,
  historyChip,
  hoursUntilExpiry,
  resultAvailability,
  type AiHistoryTone,
} from "@/lib/ai/history";
import { isActiveStatus, type AiJobView } from "@/lib/ai/jobs";
import { formatRelative } from "@/lib/i18n/format";
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

export function FrenzAIHistory({
  className,
  showHeading = true,
  groupByDay = false,
}: {
  className?: string;
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
    for (const job of history.jobs) {
      const t = Date.parse(job.createdAt);
      // An unparseable timestamp lands in Earlier rather than crashing a bucket
      // index — the row is still the member's and still worth showing.
      const at = Number.isFinite(t) ? t : 0;
      const i = at >= today ? 0 : at >= yesterday ? 1 : at >= week ? 2 : at >= lastWeek ? 3 : 4;
      buckets[i]!.items.push(job);
    }
    return buckets.filter((b) => b.items.length > 0);
  }, [groupByDay, history.jobs]);

  const close = useCallback(() => setOpenJob(null), []);

  const open = (job: AiJobView) => {
    haptic("selection");
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
          <RotateCcw className={cn("h-3.5 w-3.5", history.loading && "animate-spin motion-reduce:animate-none")} aria-hidden />
          Refresh
        </button>
      </div>

      {/* ── the tabs ────────────────────────────────────────────────────── */}
      <div role="tablist" aria-label="Filter videos" className="mt-3 flex gap-1 rounded-full bg-secondary p-1">
        {AI_HISTORY_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={history.filter === f}
            onClick={() => {
              haptic("selection");
              history.setFilter(f);
            }}
            className={cn(
              "min-h-[36px] flex-1 rounded-full px-3 text-xs font-semibold transition",
              history.filter === f
                ? "bg-card shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {AI_HISTORY_FILTER_LABELS[f]}
          </button>
        ))}
      </div>

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
                  <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                    {section.label}
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
              {history.jobs.map((job) => (
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
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-border/70 bg-card/95 px-6 py-3 text-sm font-semibold transition hover:border-foreground/20 active:scale-[0.99] disabled:opacity-70"
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
 * 🔴 THREE COLUMNS ON A PHONE, like the download gallery. That is what makes
 * this read as a wall of work rather than a settings list — and it is the
 * specific thing the owner was comparing against.
 */
const HISTORY_GRID = "grid grid-cols-3 gap-1.5 sm:grid-cols-4 sm:gap-2";

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
 * ── And the skin is deliberately NOT the same ──────────────────────────────
 *
 * "they should not carry exactly the same design they should be
 * differentiated." Download tiles are photographs of media you already own, on
 * black. These are jobs, and there is no poster to show — so a Frenz AI tile is
 * a brand-gradient plate with the mark on it, tinted by STATE: gradient when
 * there is a video to play, flat secondary when there is not. Nobody will
 * confuse the two walls, and this one still decodes no video.
 *
 * 🔴 That is not only aesthetics. A tile per row with a real poster would mean
 * a signed URL and a decode per item, on a list somebody opens to press one
 * button. The gradient costs nothing and keeps the promise this feature has
 * held since it shipped.
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
  const Tag = playable ? "button" : "div";

  return (
    <article className="min-w-0">
      <Tag
        {...(playable ? { type: "button" as const, onClick: onOpen } : {})}
        aria-label={playable ? `Play ${job.source.name ?? "cleaned video"}` : undefined}
        className={cn(
          "relative block aspect-square w-full overflow-hidden rounded-2xl",
          playable
            ? "bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500"
            : "bg-secondary",
          playable &&
            "transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        {/* The mark, centred — this is where a poster would be. */}
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center justify-center",
            playable ? "text-white/95" : "text-muted-foreground",
          )}
        >
          {active ? (
            <Loader2 className="h-7 w-7 animate-spin motion-reduce:animate-none" />
          ) : job.status === "cancelled" ? (
            <Ban className="h-7 w-7" />
          ) : job.status === "failed" ? (
            <AlertTriangle className="h-7 w-7" />
          ) : playable ? (
            <Play className="h-8 w-8 fill-current" />
          ) : (
            <Trash2 className="h-7 w-7" />
          )}
        </span>

        {/* The state chip, bottom-left — the same place the download tile puts
            its own. On a gradient it needs its own ground to stay legible. */}
        <span
          className={cn(
            "absolute bottom-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold",
            playable ? "bg-black/45 text-white" : "ring-1 ring-inset",
            !playable && TONE_CLASS[chip.tone],
          )}
        >
          {chip.label}
        </span>

        {/* Length, bottom-right, mirroring the download tile's quality badge. */}
        {job.source.durationSeconds ? (
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {formatDuration(job.source.durationSeconds)}
          </span>
        ) : null}
      </Tag>

      {/* The caption, under the tile — same rhythm as `RecentDownloads`. */}
      <div className="mt-1.5 min-w-0">
        <p className="truncate text-[12.5px] font-semibold leading-tight" title={job.source.name ?? undefined}>
          {/*
            🔴 The member's own filename, as they typed it. No `uppercase`, no
            truncation of the extension — a CSS transform is a silent edit of
            somebody's copy, and this feature has made that mistake once already
            with "WebM".
          */}
          {job.source.name ?? "Cleaned video"}
        </p>
        <p className="mt-0.5 truncate text-[11px] leading-snug text-muted-foreground">
          <TileCaption job={job} availability={availability} now={now} />
        </p>
      </div>
    </article>
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

  if (availability === "pending") return <>Still working · keeps going if you leave</>;
  if (availability === "expired") return <>Expired · kept for three days</>;
  if (job.status === "cancelled") return <>You stopped this one · {when}</>;
  if (job.status === "failed") return <>Didn&apos;t finish · {when}</>;
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
    <div className="rounded-2xl border border-dashed border-border/70 px-6 py-10 text-center">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <Sparkles className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-semibold">{copy.title}</p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">{copy.body}</p>
    </div>
  );
}

/** The grid's own shape while the first page loads — never a spinner. */
function HistorySkeleton() {
  return (
    <div className={cn(HISTORY_GRID)} aria-hidden>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="min-w-0">
          <div className="aspect-square w-full animate-pulse rounded-2xl bg-secondary motion-reduce:animate-none" />
          <div className="mt-1.5 h-3 w-3/4 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
          <div className="mt-1 h-2.5 w-1/2 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

