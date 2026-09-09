"use client";

import {
  AlertTriangle,
  Ban,
  Clock3,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

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
import { cn, formatBytes, formatDuration } from "@/lib/utils";

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
 * No posters, no `preload`, no signed urls. A row is text and a chip; the file
 * is only ever signed for when somebody taps Play, and the player itself is
 * `next/dynamic` so its markup, the compare canvases and the sheet's gesture
 * code stay off this page until they are needed. A history list that decoded a
 * frame per row to draw thumbnails would warm the phone of somebody who came
 * here to press one button, which is the rule this feature is held to
 * everywhere else.
 *
 * ── Honest about expiry ─────────────────────────────────────────────────────
 *
 * ⚠️ Nothing in this project writes the `expired` status or deletes an expired
 * object yet — `expires_at` is set at creation (72h) and no cron reads it. So a
 * row is judged by the TIMESTAMP as well as the status, and one past its window
 * says so and does not offer Play. If a retention job is added later this keeps
 * working unchanged; without one, the alternative was a Play button that opens
 * a spinner and then an error.
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

export function FrenzAIHistory({ className }: { className?: string }) {
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

  const close = useCallback(() => setOpenJob(null), []);

  const open = (job: AiJobView) => {
    haptic("selection");
    setOpenJob(job);
  };

  return (
    <section className={cn("px-4 sm:px-6", className)} aria-labelledby="ai-history-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="ai-history-heading" className="text-[1.05rem] font-bold tracking-[-0.02em]">
          Your videos
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
          <ul className="flex flex-col gap-2">
            {history.jobs.map((job) => (
              <li key={job.id}>
                <HistoryRow job={job} now={now} onOpen={() => open(job)} />
              </li>
            ))}
          </ul>
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

const TONE_CLASS: Record<AiHistoryTone, string> = {
  active: "bg-primary/12 text-primary ring-primary/25",
  good: "bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-400",
  muted: "bg-muted text-muted-foreground ring-border/60",
  warn: "bg-amber-500/12 text-amber-600 ring-amber-500/25 dark:text-amber-400",
};

function HistoryRow({ job, now, onOpen }: { job: AiJobView; now: number; onOpen: () => void }) {
  const chip = historyChip(job, now);
  const availability = resultAvailability(job, now);
  const playable = availability === "ready";
  const hours = availability === "ready" ? hoursUntilExpiry(job, now) : null;

  /*
    🔴 A ROW IS A BUTTON ONLY WHEN IT DOES SOMETHING.

    A cancelled job has no video, so rendering its row as a `<button>` would put
    a focusable, pressable-looking control on the page that answers a tap with
    nothing at all. The playable rows are buttons; the rest are plain `div`s
    that say why in their own subtitle.
  */
  const Tag = playable ? "button" : "div";

  return (
    <Tag
      {...(playable ? { type: "button" as const, onClick: onOpen } : {})}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/95 p-3 text-left",
        playable &&
          "transition hover:border-primary/30 active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <RowTile job={job} playable={playable} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
            {/*
              🔴 The member's own filename, rendered as they typed it. No
              `uppercase`, no truncation of the extension — a CSS transform is a
              silent edit of somebody's copy, and this feature has made that
              mistake once already with "WebM".
            */}
            {job.source.name ?? "Cleaned video"}
          </p>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
              TONE_CLASS[chip.tone],
            )}
          >
            {chip.label}
          </span>
        </div>

        <p className="mt-1 truncate text-xs text-muted-foreground">
          {[
            formatRelative(job.createdAt, undefined, new Date(now)),
            job.source.durationSeconds ? formatDuration(job.source.durationSeconds) : null,
            job.source.size ? formatBytes(job.source.size) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
          <RowSubtitle job={job} availability={availability} hours={hours} />
        </p>
      </div>

      {playable ? (
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <Play className="h-4 w-4 fill-current" />
        </span>
      ) : null}
    </Tag>
  );
}

/**
 * The square at the left.
 *
 * Deliberately NOT a thumbnail — see the note at the top of this file. It is a
 * gradient with one icon, which costs nothing and still tells the eye which
 * rows have a video behind them.
 */
function RowTile({ job, playable }: { job: AiJobView; playable: boolean }) {
  const active = isActiveStatus(job.status);
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
        playable
          ? "bg-gradient-to-br from-blue-600/85 via-indigo-500/85 to-fuchsia-500/85 text-white"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {active ? (
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />
      ) : job.status === "cancelled" ? (
        <Ban className="h-5 w-5" />
      ) : job.status === "failed" ? (
        <AlertTriangle className="h-5 w-5" />
      ) : playable ? (
        <Sparkles className="h-5 w-5" />
      ) : (
        <Trash2 className="h-5 w-5" />
      )}
    </span>
  );
}

/** One sentence per row, and never the same one for two different situations. */
function RowSubtitle({
  job,
  availability,
  hours,
}: {
  job: AiJobView;
  availability: ReturnType<typeof resultAvailability>;
  hours: number | null;
}) {
  if (availability === "pending") return <>Still working. This keeps going even if you close the app.</>;
  if (availability === "expired")
    return (
      <span className="inline-flex items-center gap-1">
        <Clock3 className="h-3 w-3" aria-hidden />
        Kept for three days — this one has been deleted.
      </span>
    );
  if (job.status === "cancelled") return <>You stopped this one. Nothing was used from your allowance.</>;
  if (job.status === "failed") return <>{job.error?.message ?? "This one didn't finish."}</>;
  if (availability === "ready") {
    return (
      <span className="inline-flex items-center gap-1">
        <Clock3 className="h-3 w-3" aria-hidden />
        {hours === null
          ? "Ready to watch and save."
          : hours >= 24
            ? `Available for ${Math.floor(hours / 24)} more ${Math.floor(hours / 24) === 1 ? "day" : "days"}.`
            : `Available for ${hours} more ${hours === 1 ? "hour" : "hours"}.`}
      </span>
    );
  }
  return <>No video was made.</>;
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

function HistorySkeleton() {
  return (
    <ul className="flex flex-col gap-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/95 p-3">
          <span className="h-12 w-12 shrink-0 animate-pulse rounded-xl bg-secondary motion-reduce:animate-none" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="h-3.5 w-2/3 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
            <span className="h-3 w-1/2 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
          </span>
        </li>
      ))}
    </ul>
  );
}
