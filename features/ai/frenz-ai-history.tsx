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
const HISTORY_GRID = "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4";

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
  const Tag = playable ? "button" : "div";
  const title = job.source.name ?? "Cleaned video";

  return (
    /*
      🔴 THE SAME OUTER SHELL AS `GalleryTile`, down to the ground colour.
      `group` is what lets the hover disc find it, `aspect-square` and
      `rounded-2xl` are the grid's rhythm, and `bg-black/40` is what a poster
      that has not decoded yet sits on — so a slow connection shows the same
      dark tile the download page shows, not a flash of page background.
    */
    <article
      className={cn(
        "group relative aspect-square overflow-hidden rounded-2xl bg-black/40",
        playable && "transition active:scale-[0.98]",
      )}
    >
      <Tag
        {...(playable ? { type: "button" as const, onClick: onOpen } : {})}
        aria-label={playable ? `Play ${title}` : undefined}
        className={cn(
          "absolute inset-0 h-full w-full text-left",
          playable &&
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80",
        )}
      >
        <HistoryPoster job={job} playable={playable} active={active} />

        {/*
          The scrim, and the caption INSIDE it.

          The caption used to sit under the tile, which is the other half of why
          the two pages read differently: the download gallery puts its title on
          the picture, so its rows are a wall of images with no text gutter
          between them. Same treatment here.

          🔴 INDIGO, not neutral black. The gradient is the one differentiator
          that survives being seen at a glance from across a room, and it is the
          brand's own colour rather than a decoration — see the note above the
          component.
        */}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-indigo-950/90 via-indigo-950/40 to-transparent px-2 pb-1.5 pt-10">
          <span className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-white/90">
            <Sparkles className="h-3.5 w-3.5 drop-shadow" aria-hidden />
            {job.source.durationSeconds ? formatDuration(job.source.durationSeconds) : null}
          </span>
          {/*
            🔴 The member's own filename, as they typed it. No `uppercase`, no
            truncation of the extension — a CSS transform is a silent edit of
            somebody's copy, and this feature has made that mistake once already
            with "WebM".

            `line-clamp-1` ALONE. Never paired with `block`: the two are
            single-class selectors setting the same property, Tailwind emits
            `.block` later, and the clamp silently loses — the exact bug that
            let a TikTok caption cover a whole download tile in August.
          */}
          <span className="line-clamp-1 text-[11.5px] font-semibold text-white/95">{title}</span>
          <span className="line-clamp-1 text-[10.5px] font-medium text-white/65">
            <TileCaption job={job} availability={availability} now={now} />
          </span>
        </span>

        {/*
          The play disc, on hover only — and with NO `backdrop-blur`, which is a
          standing law on anything that repeats per tile. A backdrop filter is a
          separate GPU pass that promotes its element to a layer even at zero
          opacity, so on a wall of tiles it is a few hundred passes a frame for
          chrome a touch device never even shows. The dark fill is what makes
          the glyph readable; the blur never was.
        */}
        {playable ? (
          <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white">
              <Play className="ml-0.5 h-5 w-5 fill-white" aria-hidden />
            </span>
          </span>
        ) : null}
      </Tag>

      {/*
        Top left: the FRENZ MARK, where a download tile wears its platform
        badge. Same position, same size, deliberately different meaning — what
        matters about a saved file is where it came from, and what matters about
        this one is what was done to it.
      */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500 text-white shadow"
      >
        <Sparkles className="h-3.5 w-3.5" />
      </span>

      {/*
        Top right: the state, but only when it is not simply "Ready".

        A chip on every tile saying "Ready" is a chip that means nothing — the
        picture already says the video is there. It earns its place on the rows
        that are NOT ready, which is the same judgement the download tile makes
        when it badges only failed and cancelled records.
      */}
      {chip.tone !== "good" ? (
        <span
          className={cn(
            "pointer-events-none absolute right-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold",
            playable ? "bg-black/60 text-white" : cn("ring-1 ring-inset", TONE_CLASS[chip.tone]),
          )}
        >
          {chip.label}
        </span>
      ) : (
        /*
          A ready tile gets the Before / after pill instead. It is the one thing
          this page can promise that the download page cannot, and putting it on
          the tile is what tells somebody the tap is worth making.
        */
        <span
          aria-hidden
          className="pointer-events-none absolute right-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white"
        >
          Before / after
        </span>
      )}
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
}: {
  job: AiJobView;
  playable: boolean;
  active: boolean;
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
      {/*
        🔴 The caption is INSIDE the tile now, so the skeleton is a bare square.
        A skeleton that keeps drawing two grey bars under each tile promises a
        layout the real list no longer has, and the swap from one to the other
        is a visible jump on every load.
      */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="aspect-square w-full animate-pulse rounded-2xl bg-secondary motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}

