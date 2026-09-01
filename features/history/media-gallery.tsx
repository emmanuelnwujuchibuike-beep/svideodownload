"use client";

import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Heart,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  MoreHorizontal,
  Music,
  Play,
  RotateCcw,
  Trash2,
  Video,
} from "lucide-react";

import { AdSurface } from "@/features/monetization/ad-surface";
import { ExoClickSticky, type ExoClickInsSlot } from "@/features/monetization/exoclick-sticky";
import { HilltopSlot } from "@/features/monetization/hilltop-slot";
import { isHilltopPlacementOn, type HilltopConfig } from "@/lib/monetization/hilltop-config";
import { HistoryGridAd } from "./history-grid-ad";
import { Fragment, type ComponentType, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { SmartThumb } from "@/components/ui/smart-thumb";
import { startDownload } from "@/features/downloads/manager";
import { openPlayerQueue, openPlayerQueueWithAds } from "@/features/downloads/player-store";
import { estimateBytes } from "@/features/history/usage";
import { PublishSoundSheet } from "@/features/history/publish-sound-sheet";
import { useGatedRetry } from "@/features/history/use-gated-retry";
import { RewardedAdGate } from "@/features/monetization/rewarded-ad";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { cn, formatBytes } from "@/lib/utils";
import type { DownloadRecord, MediaKind } from "@/types";

/**
 * A story ad after every N media (owner: "after 3 media").
 *
 * Matches the reels cadence deliberately — the two are the same promise to the
 * visitor, and a different number on each surface is a difference nobody asked
 * for.
 */
const HISTORY_STORY_AD_EVERY = 3;

/**
 * The HilltopAds video cadence for this surface, when it is switched on.
 *
 * Owner's brief §16: "Add video ads naturally into the history experience … Do
 * not interrupt every few items. The frequency must be configurable."
 *
 * 🔴 SEPARATE FROM `HISTORY_STORY_AD_EVERY` ABOVE, which stays at 3 and stays
 * hard-coded. That constant drives the EXISTING `history_story_ad` zone that
 * other networks already serve, and changing a working placement's rhythm to
 * accommodate a new one is the first thing the brief prohibits. When Hilltop's
 * history video is enabled it takes over the cadence for this queue with its
 * own admin-set number, and when it is off nothing about the existing behaviour
 * is different by a single item.
 */
function historyAdEvery(hilltop: HilltopConfig | null): number {
  if (!hilltop || !isHilltopPlacementOn(hilltop, "historyvideo")) return HISTORY_STORY_AD_EVERY;
  return hilltop.historyVideoEvery;
}

/**
 * Which time-period sections are followed by an in-feed ad, and WHICH SLOT each
 * one is.
 *
 * Owner, 2026-09-01: "in between the time period in history page, the yesterday
 * ending that divides the week … and add a new time zone of last week and add a
 * slot there".
 *
 * Two placements, at the two natural divisions — where Yesterday gives way to
 * the week, and where Last week gives way to Earlier. Named by BUCKET KEY rather
 * than by index so a section that is empty (and therefore filtered out) cannot
 * shift an ad onto a different boundary than the one asked for.
 *
 * 🔴 A MAP, NOT A SET, AND THAT IS THE WHOLE FIX (owner, 2026-09-01: "exoclick
 * requires each link, each page"). This was `new Set(["yesterday","lastweek"])`
 * feeding `slot="historyfeed"` to both, so both placements resolved to the same
 * configured zone id. ExoClick batches every placement on a page into ONE
 * request and refuses to serve a zone twice in it — the API answers
 * `{"zones":[null,null]}` — so the second slot could never fill, and before the
 * zone claim shipped it took the first one down with it. Two placements, two
 * slots, two admin fields, two zones.
 */
const AD_AFTER_GROUP = new Map<string, ExoClickInsSlot>([
  ["yesterday", "historyfeed"],
  ["lastweek", "historyfeedlastweek"],
]);


/**
 * The iOS-Photos-style download gallery — a Grid ⇄ List toggle, a 2–5 column
 * picker, and a sort control (Recent / Alphabetical / Largest / Top platform),
 * with view prefs persisted per-browser. Tapping any tile opens the story-style
 * player QUEUE so the whole gallery can be swiped through. Shared by the landing
 * history (HistoryPanel) and the signed-in Downloads page so both look identical
 * (owner). Callers pass ALREADY-FILTERED items (tab/search); the gallery owns the
 * sort + view.
 */

export type SortKey = "time" | "az" | "size" | "platform";
type ViewMode = "grid" | "list";

/** Premium tactile feedback fired on every history control — a soft haptic + the
 *  same nav "tap" tone the bottom nav uses (owner: "haptic sound in all the buttons
 *  in the history page"). */
function tap() {
  haptic("light");
  playSound("tap");
}

const KIND_ICON: Record<MediaKind, ComponentType<{ className?: string }>> = {
  video: Video,
  audio: Music,
  image: ImageIcon,
};

const SORTS: { key: SortKey; label: string }[] = [
  { key: "time", label: "Recent" },
  { key: "az", label: "Alphabetical" },
  { key: "size", label: "Largest" },
  { key: "platform", label: "Top platform" },
];

const COLUMN_CHOICES = [2, 3, 4, 5] as const;

/**
 * Roughly how much of a caption survives one clamped line on a grid tile.
 *
 * Only decides whether to render the "…more" cue — the CLAMP itself is CSS and
 * always exact. A character count cannot know the real wrap point (font, tile
 * width, column count all move it), so this is deliberately conservative: a
 * caption near the boundary may show "…more" with almost nothing hidden, which
 * is a far better failure than hiding the cue on a caption that IS cut off.
 */
const CAPTION_PREVIEW_CHARS = 40;

const VIEW_KEY = "frenz:gallery-view";
const COLS_KEY = "frenz:gallery-cols";
const SORT_KEY = "frenz:gallery-sort";

/** `137` → `2:17`. Used for the duration chip on a history tile. */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

function timeAgo(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatDateTime(ts: number): { date: string; time: string } {
  const d = new Date(ts);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return {
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) }),
    time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

/** Sort a copy of `items`. "Top platform" ranks by how many downloads each
 *  platform has (most first), then newest within it. */
export function sortItems(items: DownloadRecord[], sort: SortKey): DownloadRecord[] {
  const arr = [...items];
  if (sort === "az") return arr.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "size") return arr.sort((a, b) => estimateBytes(b) - estimateBytes(a));
  if (sort === "platform") {
    const counts = new Map<string, number>();
    for (const it of arr) counts.set(it.platform, (counts.get(it.platform) ?? 0) + 1);
    return arr.sort((a, b) => {
      const d = (counts.get(b.platform) ?? 0) - (counts.get(a.platform) ?? 0);
      if (d) return d;
      if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
      return b.createdAt - a.createdAt;
    });
  }
  return arr.sort((a, b) => b.createdAt - a.createdAt);
}

export interface GallerySelection {
  active: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}

export function MediaGallery({
  items,
  onToggleFavorite,
  onRemove,
  initialGrid = 18,
  initialList = 8,
  emptyText = "No downloads yet.",
  groupByDay = false,
  selection,
}: {
  items: DownloadRecord[];
  onToggleFavorite: (id: string) => void;
  onRemove: (id: string) => void;
  initialGrid?: number;
  initialList?: number;
  emptyText?: string;
  /** Break the grid into Today / Yesterday / This week / Earlier sections, each
   *  with a count and collapsible (the history reference,
   *  public/new downloadhistory.jpg). Only meaningful with the Recent sort — any
   *  other order would put the same day in several places, so it's ignored. */
  groupByDay?: boolean;
  /** Multi-select mode: tiles toggle instead of opening the player. */
  selection?: GallerySelection;
}) {
  /*
    The HilltopAds config, for the video cadence only. One cached request, and
    null until it lands — `historyAdEvery` falls back to the existing constant,
    so a slow or failed config fetch leaves the queue exactly as it has always
    behaved rather than removing its ads.
  */
  const [hilltopConfig, setHilltopConfig] = useState<HilltopConfig | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { hilltop?: HilltopConfig }) => {
        if (alive && d.hilltop) setHilltopConfig(d.hilltop);
      })
      .catch(() => {
        /* The existing cadence is the safe outcome. */
      });
    return () => {
      alive = false;
    };
  }, []);

  const [view, setView] = useState<ViewMode>("grid");
  /*
    TWO columns by default (owner, 2026-08-09: "make the grid cols selectable,
    grid cols 2 as default").

    The reference image is drawn at three, and three is what this defaulted to —
    but at three, on a phone, a downloaded video is a 110px thumbnail with a
    one-line title under it, and you cannot tell two clips of the same creator
    apart. Two is the width at which a thumbnail is actually a preview. The
    picker is right there for anyone who wants to see more at once, and the
    choice persists per browser.
  */
  const [cols, setCols] = useState<number>(2);
  const [sort, setSort] = useState<SortKey>("time");
  const [limit, setLimit] = useState(initialGrid);
  // Feature 15 Part 7 — one sheet instance for the whole gallery (grid + list
  // both open it via the same handler), rather than one per tile.
  const [publishTarget, setPublishTarget] = useState<DownloadRecord | null>(null);
  /* Retries go through the same reward-ad policy a first attempt does — see
     use-gated-retry.ts. One instance for the whole gallery. */
  const retry = useGatedRetry();

  // Load persisted view prefs after mount (client-only — the panels this renders
  // in only paint after the local history loads, so there is no SSR mismatch).
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "grid" || v === "list") setView(v);
      const c = Number(localStorage.getItem(COLS_KEY));
      if (COLUMN_CHOICES.includes(c as (typeof COLUMN_CHOICES)[number])) setCols(c);
      const s = localStorage.getItem(SORT_KEY);
      if (s && SORTS.some((o) => o.key === s)) setSort(s as SortKey);
    } catch {
      /* storage blocked — defaults are fine */
    }
  }, []);

  const persist = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  };

  const sorted = useMemo(() => sortItems(items, sort), [items, sort]);
  const initial = view === "grid" ? initialGrid : initialList;
  const shown = sorted.slice(0, limit);

  /*
    Day groups. Only for the Recent sort — under "Largest" or "Alphabetical" the
    same day would appear in several places, so a "Today" heading would be a lie.
    Grouping shows EVERYTHING rather than paging, because the headings are the
    way you navigate a long history; a "Show more" under them would fight that.
  */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const grouped = useMemo(() => {
    if (!groupByDay || sort !== "time") return null;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const today = midnight.getTime();
    const yesterday = today - 86_400_000;
    const week = today - 6 * 86_400_000;
    /*
      "Last week" (owner, 2026-09-01: "add a new time zone of last week").
      The seven days before "This week" — so the two together cover a fortnight
      and "Earlier" starts where a reader stops thinking in weeks at all.
    */
    const lastWeek = today - 13 * 86_400_000;

    const buckets: { key: string; label: string; items: DownloadRecord[] }[] = [
      { key: "today", label: "Today", items: [] },
      { key: "yesterday", label: "Yesterday", items: [] },
      { key: "week", label: "This week", items: [] },
      { key: "lastweek", label: "Last week", items: [] },
      { key: "earlier", label: "Earlier", items: [] },
    ];
    for (const item of sorted) {
      const t = item.createdAt;
      const bucket = t >= today ? 0 : t >= yesterday ? 1 : t >= week ? 2 : t >= lastWeek ? 3 : 4;
      buckets[bucket]!.items.push(item);
    }
    return buckets.filter((b) => b.items.length > 0);
  }, [groupByDay, sort, sorted]);
  const openAt = (idx: number) => {
    haptic("light");
    /*
      History is the ONLY surface that opens the queue with story ads.
      Continue Watching, the review player and the floating card all call
      `openPlayerQueue` and never see one.
    */
    openPlayerQueueWithAds(sorted, idx, historyAdEvery(hilltopConfig));
  };

  /*
    Deep-link review (owner, 2026-08-04): the download-complete card links here
    with `?review=<id>` instead of opening its own isolated player, so the clip
    is reviewed in history with the whole library as its queue.

    Runs ONCE per id: the ref guard stops the player reopening every time
    `sorted` changes (a sort switch, a new download landing) — which would yank
    a visitor who had already closed it straight back in. The query param is
    then stripped with `replaceState`, so a refresh or a Back doesn't replay it.
    A missing id simply does nothing; history is already the right place to be.
  */
  const reviewed = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || sorted.length === 0) return;
    const id = new URLSearchParams(window.location.search).get("review");
    if (!id || reviewed.current === id) return;
    reviewed.current = id;
    const idx = sorted.findIndex((item) => item.id === id);
    if (idx >= 0) openPlayerQueue(sorted, idx);
    const url = new URL(window.location.href);
    url.searchParams.delete("review");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    // `sorted` is intentionally the only dependency — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted]);

  return (
    <div>
      {/* Controls: sort · view · (grid) columns */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="inline-flex h-11 items-center gap-2 rounded-xl bg-secondary/60 px-3.5 text-sm shadow-sm ring-1 ring-inset ring-border/40">
          <span className="text-muted-foreground">Sort</span>
          <select
            value={sort}
            onChange={(e) => { tap(); const s = e.target.value as SortKey; setSort(s); persist(SORT_KEY, s); setLimit(initial); }}
            aria-label="Sort downloads"
            className="bg-transparent font-semibold text-foreground outline-none"
          >
            {SORTS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>

        <div className="inline-flex rounded-xl bg-secondary/60 p-1 shadow-sm ring-1 ring-inset ring-border/40">
          <ViewButton active={view === "grid"} label="Grid" onClick={() => { setView("grid"); persist(VIEW_KEY, "grid"); setLimit(initialGrid); }}>
            <LayoutGrid className="h-4 w-4" />
          </ViewButton>
          <ViewButton active={view === "list"} label="List" onClick={() => { setView("list"); persist(VIEW_KEY, "list"); setLimit(initialList); }}>
            <ListIcon className="h-4 w-4" />
          </ViewButton>
        </div>

        {view === "grid" ? (
          <div className="inline-flex items-center gap-1 rounded-xl bg-secondary/60 p-1 shadow-sm ring-1 ring-inset ring-border/40">
            {COLUMN_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => { tap(); setCols(n); persist(COLS_KEY, String(n)); }}
                aria-label={`${n} columns`}
                aria-pressed={cols === n}
                className={cn(
                  "h-9 w-9 rounded-xl text-sm font-bold tabular-nums transition duration-150 active:scale-[0.9]",
                  cols === n ? "bg-background text-foreground shadow-sm ring-1 ring-inset ring-border/60" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/*
        The history placement (owner, 2026-08-30: "put an exoclick in video
        banner above history the media in history page just below the grid
        cols numbers").

        Exactly there: after the toolbar that holds the column-count control,
        before the media itself. Full-bleed like every other video zone, and
        it collapses to nothing when unseeded, so a site without ExoClick sees
        the gallery it always had.
      */}
      {/*
        🔴 An ExoClick OUTSTREAM VIDEO tag, not the VAST surface (owner,
        2026-08-30: "make the history above the grid to use this style of ad
        format, outstream video").

        Outstream is ExoClick's DISPLAY product — their loader fills an <ins>
        and manages the player itself — so it does not go through the VAST
        pipeline the five vertical zones use. Full width, in the page's flow,
        directly under the column-count control.

        The `history_above_grid` zone stays declared: an operator can still
        seed it with any other format, and this tag simply renders above it.
      */}
      {/*
        🔴 FULL-BLEED AND CENTRED (owner, 2026-08-30: "center this banner and
        make it have more width to reach full width with px 1.5").

        The gallery sits in `mx-auto max-w-6xl px-2 sm:px-4`, so the banner was
        inset by the page gutter AND the creative — a fixed-size native unit —
        sat hard left inside a full-width <ins>, which is what read as "not
        centred, not full width".

        The negative margin cancels exactly the gutter this is nested in, then
        `px-1.5` puts back the 6px the owner asked for. Kept in step with the
        container above: if that padding changes, this has to change with it.
      */}
      <div className="-mx-2 mb-4 px-1.5 sm:-mx-4">
        {/*
          🔴 HILLTOP SITS BESIDE EXOCLICK, IT DOES NOT REPLACE IT (owner,
          2026-09-01: "set up the ad to be used in those places where exoclick
          are used"). Both render, and each collapses to nothing when its own
          field is empty — so an operator switches networks by clearing one and
          filling the other, with no deploy and no window where the page has no
          ad at all. Unlike two ExoClick units, these cannot cost each other a
          fill: Hilltop makes its own request where its script sits.
        */}
        <HilltopSlot slot="history" />
        <HistoryGridAd />
      </div>
      {/*
        🔴 NO VAST SLOT HERE (owner, 2026-08-30: "the history above grid
        showing in vertical instead of horizontal … i only said a horizontal
        outstream video").

        An `AdSurface` for `history_above_grid` was left rendering beside the
        outstream tag above. That zone is shared-ID eligible, so it filled
        with the 9:16 VERTICAL creative every other ExoClick zone serves —
        which is the tall unit that appeared here. Two ad slots stacked, one
        of them the wrong shape entirely.

        The top of the history feed takes the horizontal outstream tag and
        nothing else. The zone stays declared so it can be seeded
        deliberately later, but it is no longer rendered here.
      */}

      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : view === "grid" && grouped ? (
        <div className="space-y-5">
          {grouped.map((g) => (
            /*
              🔴 `content-visibility: auto` per day section (owner, 2026-08-10:
              "the history is taking time to navigate because of load when there
              are too many history").

              The diagnosis, from the code above: the grouped view deliberately
              renders EVERYTHING — and that is the right call, because the day
              headings are how you navigate a long history and a "Show more"
              under them would fight the thing that makes them useful. Paging
              here would trade a real navigation aid for a loading trick.

              So the fix keeps every item in the DOM and makes the OFF-SCREEN
              ones free. `content-visibility: auto` lets the browser skip
              layout, paint and image decode for a section until it approaches
              the viewport. Nothing is removed: scroll height, in-page find,
              Select-all and anchor scrolling all still see the whole list,
              which is exactly what a virtualised list would have broken.

              `contain-intrinsic-size: auto 420px` is the placeholder height
              used before a section has ever been rendered; the `auto` keyword
              makes the browser remember each section's REAL height afterwards,
              so the scrollbar stops jumping after the first pass. Without a
              stated size the sections would collapse to zero and the page would
              have no scrollable length at all.

              Thumbnails are already `loading="lazy"`, which stopped the
              network cost but not the DOM/layout cost — a hundred tiles are
              still a hundred trees to build and hydrate. This is the half that
              was missing.
            */
            <Fragment key={g.key}>
              <section
              className="[content-visibility:auto] [contain-intrinsic-size:auto_420px]"
            >
              <button
                type="button"
                onClick={() => { tap(); setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] })); }}
                aria-expanded={!collapsed[g.key]}
                className="mb-2 flex w-full items-center justify-between gap-3 text-left"
              >
                <span className="text-lg font-bold tracking-tight">{g.label}</span>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {g.items.length} item{g.items.length === 1 ? "" : "s"}
                  <ChevronDown className={cn("h-4 w-4 transition-transform", collapsed[g.key] && "-rotate-90")} />
                </span>
              </button>
              {collapsed[g.key] ? null : (
                <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                  {g.items.map((item) => (
                    <GalleryTile
                      key={item.id}
                      item={item}
                      onOpen={() => openAt(sorted.indexOf(item))}
                      onToggleFavorite={() => onToggleFavorite(item.id)}
                      onRemove={() => onRemove(item.id)}
                      onPublishSound={() => setPublishTarget(item)}
                      onRetry={() => retry.begin(item)}
                      selection={selection}
                    />
                  ))}
                </div>
              )}
              </section>
              {/*
                🔴 IN-FEED AD, BETWEEN THE TIME PERIODS (owner, 2026-09-01: "put
                an ad slot … in between the time period in history page, the
                yesterday ending that divides the week … and add a new time zone
                of last week and add a slot there").

                OUTSIDE the <section>, deliberately. Each section carries
                `content-visibility: auto`, which lets the browser skip layout and
                paint for it while off-screen — and an ad slot inside one would be
                skipped with it, so the loader would be filling a placeholder the
                browser has not laid out. A sibling between sections is both the
                position asked for and the only place the unit is always real.

                An outstream tag is a GOOD fit here, unlike above the grid: their
                viewability rule wants the slot scrolled into view, and a reader
                moving between time periods is doing exactly that.

                Each boundary renders ITS OWN slot id, which resolves to its own
                admin field and therefore its own ExoClick zone — see the map.
              */}
              {(() => {
                const adSlot = AD_AFTER_GROUP.get(g.key);
                return adSlot ? (
                  <div className="-mx-2 px-1.5 sm:-mx-4">
                    {/*
                      🔴 ANY NETWORK HERE, NOT ONLY EXOCLICK (owner, 2026-09-01:
                      "make the in feed slot, history period separator ... to be
                      able to use adsense and adsterra banner iframe and social
                      link and native ad").

                      `history_between_periods` is an ordinary AD ZONE, so it is
                      configured as a ROW in the ads table and can carry an
                      AdSense unit, an Adsterra banner iframe, a social-link or a
                      native row — all the formats the registry already supports.
                      One zone at both boundaries is fine for these networks and
                      is what `landing_section_break` already does eight times on
                      the landing page. The ExoClick one-zone-per-request rule is
                      an ExoClick rule, and it applies to the snippet slot below,
                      which keeps its own per-boundary field.

                      Both render: an operator may run one, the other, or
                      neither, and each collapses to nothing when it has no ad.
                      Filling both is a deliberate choice, not an accident.
                    */}
                    <AdSurface zone="history_between_periods" maxWidth="max-w-3xl" />
                    <HilltopSlot slot="historyfeed" instanceKey={g.key} />
                    <ExoClickSticky slot={adSlot} />
                  </div>
                ) : null;
              })()}
            </Fragment>
          ))}
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {shown.map((item, i) => (
            <GalleryTile key={item.id} item={item} onOpen={() => openAt(i)} onToggleFavorite={() => onToggleFavorite(item.id)} onRemove={() => onRemove(item.id)} onPublishSound={() => setPublishTarget(item)} onRetry={() => retry.begin(item)} selection={selection} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          {shown.map((item, i) => (
            <ListRow key={item.id} item={item} onOpen={() => openAt(i)} onToggleFavorite={() => onToggleFavorite(item.id)} onRemove={() => onRemove(item.id)} onPublishSound={() => setPublishTarget(item)} onRetry={() => retry.begin(item)} selection={selection} />
          ))}
        </div>
      )}

      {/* Grouped view renders everything under its headings, so paging would
          only get in the way of them. */}
      {grouped && view === "grid" ? null : sorted.length > limit ? (
        <div className="mt-5 text-center">
          <button type="button" onClick={() => setLimit((n) => n + initial)} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold shadow-soft transition hover:bg-secondary">
            Show more ({sorted.length - limit})
          </button>
        </div>
      ) : sorted.length > initial ? (
        <div className="mt-5 text-center">
          <button type="button" onClick={() => setLimit(initial)} className="text-sm font-medium text-muted-foreground transition hover:text-foreground">
            Show less
          </button>
        </div>
      ) : null}

      <PublishSoundSheet open={!!publishTarget} onClose={() => setPublishTarget(null)} item={publishTarget} />

      {/*
        Reward gate for RETRIES (owner, 2026-08-24: "every retry downloads should
        follow same ad system like others"). Both retry controls route through
        `useGatedRetry`, which asks the same `rewardAdsFor` policy a first attempt
        does — so a large video retry costs an ad and a single image never does.
        Mounted once here rather than per tile: one gate for the whole gallery,
        and a tile that scrolls out of view mid-ad cannot take the ad with it.
      */}
      <RewardedAdGate
        open={retry.gated}
        durationSec={retry.ads[0]?.durationSec ?? 30}
        skipAfterSec={retry.ads[0]?.skipAfterSec ?? null}
        step={retry.ads.length > 1 ? 1 : undefined}
        totalSteps={retry.ads.length > 1 ? retry.ads.length : undefined}
        onReward={retry.grantOne}
        onCancel={retry.cancel}
      />
    </div>
  );
}

/** iOS-Photos-style square tile. */
/**
 * One history tile — built to public/mainhistorypage.jpg.
 *
 * The reference's anatomy, corner by corner:
 *   top-left     a small rounded badge for what the item IS
 *   top-right    a circular "…" that opens the item's actions
 *   bottom-left  a media glyph and, for a video, its length
 *   bottom       the title over a scrim
 *
 * ── Why "…" replaced the heart ────────────────────────────────────────────────
 * The heart was the only action a tile had, so everything else — copy the link,
 * download it again, remove it — lived exclusively in List view. Someone in Grid
 * view had no way to reach them at all. The menu keeps favouriting as its first
 * entry and gives the other three a home, which is what the reference's "…"
 * implies and what the page was missing.
 *
 * ── Why the duration is sometimes absent ──────────────────────────────────────
 * `durationSeconds` is only known when the extractor reported it, and every
 * record saved before that field existed has none. A missing length shows the
 * glyph alone, exactly as the reference's photo tiles do — never "0:00", which
 * would be a statement about the file rather than a gap in what we know.
 */
function GalleryTile({
  item,
  onOpen,
  onToggleFavorite,
  onRemove,
  onPublishSound,
  onRetry,
  selection,
}: {
  item: DownloadRecord;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onRemove: () => void;
  onPublishSound: () => void;
  /* Retry a failed/cancelled record THROUGH the reward gate — never call
     startDownload directly from a retry control, or the ad policy is skipped
     (owner, 2026-08-24). Supplied by MediaGallery via useGatedRetry. */
  onRetry: () => void;
  selection?: GallerySelection;
}) {
  const platform = PLATFORMS[item.platform] ?? PLATFORMS.generic;
  const Icon = BRAND_ICONS[item.platform];
  const KindIcon = KIND_ICON[item.kind] ?? Video;
  const selecting = !!selection?.active;
  const picked = !!selection?.selected.has(item.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /* Absent status means completed (types/index.ts) — a bare `!== "completed"`
     would badge every pre-2026-08-23 record in the visitor's own localStorage
     as failed. */
  const isRetryable = (item.status ?? "completed") !== "completed";
  /* Same payload the tile menu's "Download again" submits — kept as one
     function so the two can't drift into re-submitting different things. */
  const retry = () =>
    startDownload({
      url: item.url,
      formatId: item.formatId,
      kind: item.kind,
      title: item.title,
      thumbnail: item.thumbnail,
      platform: item.platform,
      platformName: item.platformName,
      qualityLabel: item.qualityLabel,
      durationSeconds: item.durationSeconds ?? null,
      directUrl: item.directUrl ?? undefined,
    });

  // Close on any outside tap. A menu pinned to a tile in a scrolling grid that
  // stays open while you scroll away is worse than no menu.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("pointerdown", close);
    };
  }, [menuOpen]);

  return (
    <div className={cn("group relative aspect-square overflow-hidden rounded-2xl bg-black/40", picked && "ring-2 ring-primary")}>
      <button
        type="button"
        // In select mode the whole tile toggles instead of opening the player —
        // otherwise picking items would launch a video on every tap.
        onClick={selecting ? () => { tap(); selection!.onToggle(item.id); } : onOpen}
        aria-label={selecting ? `${picked ? "Deselect" : "Select"} ${item.title}` : `Watch ${item.title}`}
        aria-pressed={selecting ? picked : undefined}
        className="absolute inset-0 h-full w-full"
      >
        <SmartThumb src={item.thumbnail} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" fallback={<KindIcon className="h-7 w-7" />} />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent px-2 pb-1.5 pt-10">
          {/* The duration chip sits ABOVE the title, as in the reference. */}
          <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-white/90">
            <KindIcon className="h-3.5 w-3.5 drop-shadow" />
            {item.kind === "video" && item.durationSeconds ? formatClock(item.durationSeconds) : null}
          </span>
          {/*
            ── ONE line, ellipsised (owner, 2026-08-09) ────────────────────────
            "media caption in history page shouldn't show everything, it should
            only show one line with three dots."

            🔴 The class was `line-clamp-1 block`, and those CANCEL EACH OTHER.
            `line-clamp-1` works by setting `display: -webkit-box`; `block` sets
            `display: block`. Both are single-class selectors, so specificity
            ties and the LATER rule in the stylesheet wins — and Tailwind emits
            `.block` after `.line-clamp-1` (verified by running the Tailwind CLI
            over both). The clamp was silently dead, so a TikTok caption — which
            is what `title` is for a downloaded slideshow — rendered in full and
            covered the entire thumbnail.

            `line-clamp-1` alone is already block-level. Never pair the two.
          */}
          <span className="line-clamp-1 text-left text-[11px] font-medium text-white/95">{item.title}</span>
          {/*
            "…more" — the affordance for the rest (owner: "three dots at the
            caption for see more that opens the media and caption").

            Not a separate control: the whole tile is already a button that
            opens the player, and the player shows the caption in full. A second
            tap target inside a 50%-width tile would be a mis-tap generator, so
            this is a LABEL that says where the rest is, on the thing you were
            going to tap anyway. Shown only when the text is actually cut off.
          */}
          {item.title.length > CAPTION_PREVIEW_CHARS ? (
            <span aria-hidden className="mt-0.5 block text-left text-[10px] font-semibold text-white/70">
              …more
            </span>
          ) : null}
        </span>
        {/*
          🔴 No `backdrop-blur` on anything that repeats per tile (owner,
          2026-08-10: performance on the history page).

          `backdrop-filter` is not a paint, it is a separate GPU pass that
          re-samples everything behind the element. One of those is cheap. This
          gallery renders a hundred-plus tiles and each carried up to three —
          the play disc, the menu button and the favourite heart — so a scroll
          asked the compositor for a few hundred blur passes per frame. That is
          a phone getting hot for chrome nobody is looking at.

          The blur was also doing almost no work: these chips sit on TOP of a
          photo, and what makes the glyph readable is the dark fill, not the
          blur behind it. The fills are two stops stronger to make that
          explicit, which is a better contrast guarantee over a bright
          thumbnail than the blur ever was.

          This disc is `opacity-0` until hover, and that does NOT save anything:
          a backdrop-filter still promotes the element to its own layer at zero
          opacity, and on a touch device there is no hover, so it was pure cost
          forever. The dialog menu below keeps its blur — one element, only
          while open.
        */}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white">
            <Play className="ml-0.5 h-5 w-5 fill-white" />
          </span>
        </span>
      </button>

      <span className={cn("pointer-events-none absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow", platform.accent)}>
        {Icon ? <Icon className="h-3.5 w-3.5" /> : <KindIcon className="h-3.5 w-3.5" />}
      </span>

      {/*
        FAILED / CANCELLED, IN GRID VIEW TOO (owner, 2026-08-23: "i dont see the
        failed cancelled in history to retry").

        The list row had a badge from the start; this tile had nothing, and Grid
        is the view this gallery opens in — so on the default screen a failed
        download was indistinguishable from a file the visitor actually has.
        Retry is a real button rather than a menu entry for the same reason it
        is one in the list row: the whole point of keeping the record is that
        getting the file is one obvious tap away.

        Hidden while selecting, matching every other per-tile control — a
        button that starts a download beside a selection you are still building
        is a mis-tap with a real consequence.
      */}
      {isRetryable && !selecting ? (
        <span className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1.5">
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white",
              item.status === "failed" ? "bg-rose-600/90" : "bg-black/70",
            )}
          >
            {item.status === "failed" ? "Failed" : "Cancelled"}
          </span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); tap(); onRetry(); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Retry ${item.title}`}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-white/95 px-1.5 py-0.5 text-[10px] font-bold text-neutral-900 transition active:scale-[0.94]"
          >
            <RotateCcw className="h-3 w-3" />
            Retry
          </button>
        </span>
      ) : null}

      {/* In select mode the corner shows the tick instead of the menu — opening
          a menu mid-selection is an easy mis-tap with an annoying result. */}
      {selecting ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-white/80 transition",
            picked ? "bg-primary text-primary-foreground" : "bg-black/30",
          )}
        >
          {picked ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      ) : (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); tap(); setMenuOpen((o) => !o); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Actions for ${item.title}`}
            aria-expanded={menuOpen}
            className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white transition duration-150 hover:bg-black/70 active:scale-[0.85]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {/* A favourite is worth seeing at a glance without opening anything,
              so it keeps a corner of its own once it is set. */}
          {item.favorite ? (
            <span aria-hidden className="pointer-events-none absolute right-1.5 top-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/55">
              <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500" />
            </span>
          ) : null}

          {menuOpen ? (
            <div
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute right-1.5 top-10 z-20 w-40 overflow-hidden rounded-xl border border-border/70 bg-card/95 text-left shadow-elevated backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
            >
              <TileAction
                icon={<Heart className={cn("h-3.5 w-3.5", item.favorite && "fill-rose-500 text-rose-500")} />}
                label={item.favorite ? "Unfavourite" : "Favourite"}
                onClick={() => { onToggleFavorite(); setMenuOpen(false); }}
              />
              <TileAction
                icon={isRetryable ? <RotateCcw className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                label={isRetryable ? "Retry download" : "Download again"}
                onClick={() => {
                  if (isRetryable) onRetry();
                  else retry();
                  setMenuOpen(false);
                }}
              />
              <TileAction
                icon={copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                label={copied ? "Copied" : "Copy link"}
                onClick={() => {
                  void navigator.clipboard?.writeText(item.url).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }).catch(() => {});
                }}
              />
              {item.kind === "audio" ? (
                <TileAction
                  icon={<Music className="h-3.5 w-3.5" />}
                  label="Publish as sound"
                  onClick={() => { onPublishSound(); setMenuOpen(false); }}
                />
              ) : null}
              <TileAction
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="Remove"
                destructive
                onClick={() => { onRemove(); setMenuOpen(false); }}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function TileAction({
  icon,
  label,
  destructive,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => { tap(); onClick(); }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold transition hover:bg-secondary",
        destructive && "text-rose-500 hover:bg-rose-500/10",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Compact, professional list row. */
/**
 * 🔴 Select mode did NOTHING in list view (owner, 2026-08-10: "multiple select
 * don't work when I use them").
 *
 * `GalleryTile` was passed `selection` and this row was not — so switching to
 * the list layout silently turned the feature off. Every symptom pointed away
 * from the cause: Select still highlighted in the header, the action bar still
 * appeared, and tapping a row just opened the item, so it read as taps not
 * registering rather than as a whole layout being unwired.
 *
 * The contract is now identical to the tile's: while selecting, the row's
 * primary targets toggle instead of opening, the per-row actions are withdrawn
 * (a Remove button next to a selection you are building is a mis-tap with an
 * irreversible result), and the state is announced through `aria-pressed`.
 */
function ListRow({ item, onOpen, onToggleFavorite, onRemove, onPublishSound, onRetry, selection }: { item: DownloadRecord; onOpen: () => void; onToggleFavorite: () => void; onRemove: () => void; onPublishSound: () => void; onRetry: () => void; selection?: GallerySelection }) {
  const selecting = !!selection?.active;
  const picked = !!selection?.selected.has(item.id);
  /* One handler for both hit areas — the thumbnail and the text block are two
     buttons, and in select mode they must agree. */
  const activate = selecting ? () => { tap(); selection!.onToggle(item.id); } : onOpen;
  const [copied, setCopied] = useState(false);
  const [redownloading, setRedownloading] = useState(false);
  /* Absent status means completed — see the badge's note below and the field's
     own note in types/index.ts. Never write this as `!== "completed"` against
     a bare `item.status`. */
  const isRetryable = (item.status ?? "completed") !== "completed";
  const platform = PLATFORMS[item.platform] ?? PLATFORMS.generic;
  const Icon = BRAND_ICONS[item.platform];
  const KindIcon = KIND_ICON[item.kind] ?? Video;
  const { date, time } = formatDateTime(item.createdAt);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const reDownload = () => {
    setRedownloading(true);
    startDownload({
      url: item.url,
      formatId: item.formatId,
      kind: item.kind,
      title: item.title,
      thumbnail: item.thumbnail,
      platform: item.platform,
      platformName: item.platformName,
      qualityLabel: item.qualityLabel,
      directUrl: item.directUrl ?? undefined,
    });
    setTimeout(() => setRedownloading(false), 1200);
  };

  return (
    <div className={cn("flex items-center gap-3 border-b border-border/50 px-2.5 py-2.5 last:border-b-0 hover:bg-secondary/40 sm:px-3", picked && "bg-primary/10")}>
      {/* The tick, in the same slot the grid tile uses, so the two layouts read
          as one feature. It leads the row here because a list is scanned down
          the left edge. */}
      {selecting ? (
        <span
          aria-hidden
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-2 transition",
            picked ? "bg-primary text-primary-foreground ring-primary" : "bg-transparent ring-border",
          )}
        >
          {picked ? <Check className="h-3 w-3" /> : null}
        </span>
      ) : null}
      <button
        type="button"
        onClick={activate}
        aria-label={selecting ? `${picked ? "Deselect" : "Select"} ${item.title}` : `Watch ${item.title}`}
        aria-pressed={selecting ? picked : undefined}
        className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-black/40 sm:h-16 sm:w-16"
      >
        <SmartThumb src={item.thumbnail} alt="" className="h-full w-full object-cover" fallback={<KindIcon className="h-5 w-5" />} />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
          <Play className="h-5 w-5 fill-white text-white drop-shadow" />
        </span>
        <span className={cn("absolute bottom-0.5 left-0.5 flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br text-white shadow", platform.accent)}>
          {Icon ? <Icon className="h-2.5 w-2.5" /> : <KindIcon className="h-2.5 w-2.5" />}
        </span>
      </button>

      <button
        type="button"
        onClick={activate}
        aria-pressed={selecting ? picked : undefined}
        className="min-w-0 flex-1 text-left"
      >
        <p className="truncate text-sm font-semibold leading-tight">{item.title}</p>
        {/*
          Failed and cancelled attempts now live in history so they can be
          retried later (owner, 2026-08-23), which only helps if you can TELL
          them apart from the files you actually have.

          🔴 `?? "completed"` is load-bearing: history is the visitor's own
          localStorage and every record written before `status` existed has
          none. A bare `!== "completed"` check would badge everyone's entire
          existing library as failed. See the field's note in types/index.ts.

          🔴 THE BADGE ALONE WAS NOT ENOUGH (owner, 2026-08-23: "i dont see the
          failed cancelled in history to retry"). The original note here argued
          that retrying "needs no new control" because the row already has a
          Re-download action — but that action is one unlabelled download glyph
          among five identical icon buttons, and nothing connected it to the
          failure. An explicit Retry sits in the actions row below for exactly
          these records; see `isRetryable` there.
        */}
        {(item.status ?? "completed") !== "completed" ? (
          <p
            className={cn(
              "mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              item.status === "failed"
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-300"
                : "bg-secondary text-muted-foreground",
            )}
          >
            {item.status === "failed" ? "Failed" : "Cancelled"}
            {item.status === "failed" && item.failureReason ? (
              <span className="font-medium normal-case opacity-80">· {item.failureReason}</span>
            ) : null}
          </p>
        ) : null}
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {item.platformName} · {item.qualityLabel} · {formatBytes(estimateBytes(item))}
        </p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground/70">
          <Clock className="h-3 w-3 shrink-0" />
          <span className="tabular-nums">{date} · {time}</span>
          <span aria-hidden>·</span>
          {timeAgo(item.createdAt)}
        </p>
      </button>

      {/* Withdrawn while selecting — the grid tile hides its menu for the same
          reason. A Remove button beside a selection you are still building is a
          mis-tap with an irreversible result, and the row's whole width should
          be one target once Select is on. */}
      <div className={cn("flex shrink-0 items-center", selecting && "hidden")}>
        <IconButton label="Favorite" onClick={onToggleFavorite} active={item.favorite}>
          <Heart className={cn("h-4 w-4", item.favorite && "fill-current")} />
        </IconButton>
        {item.kind === "audio" ? (
          <span className="hidden sm:inline-flex">
            <IconButton label="Publish as sound" onClick={onPublishSound}>
              <Music className="h-4 w-4" />
            </IconButton>
          </span>
        ) : null}
        <span className="hidden sm:inline-flex">
          <IconButton label="Copy link" onClick={copyLink}>
            {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
          </IconButton>
        </span>
        {/*
          A failed or cancelled record gets a LABELLED Retry instead of the
          icon-only Re-download. Same handler and same submitted payload — the
          difference is entirely that it is legible. "Re-download" is also
          simply the wrong word for a file that was never downloaded once.
        */}
        {isRetryable ? (
          <button
            type="button"
            onClick={() => { tap(); onRetry(); }}
            disabled={redownloading}
            aria-label={`Retry ${item.title}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition active:scale-[0.94] disabled:opacity-60"
          >
            {redownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Retry
          </button>
        ) : (
          <IconButton label="Re-download" onClick={reDownload} disabled={redownloading}>
            {redownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          </IconButton>
        )}
        <IconButton label="Remove" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

function ViewButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => { tap(); onClick(); }}
      aria-label={`${label} view`}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition duration-150 active:scale-[0.94]",
        active ? "bg-background text-foreground shadow-sm ring-1 ring-inset ring-border/60" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function IconButton({ children, label, onClick, active, disabled }: { children: ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => { tap(); onClick(); }}
      disabled={disabled}
      className={cn(
        "rounded-xl p-2 text-muted-foreground transition duration-150 hover:bg-secondary hover:text-foreground active:scale-[0.88] disabled:opacity-50",
        active && "text-primary hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}
