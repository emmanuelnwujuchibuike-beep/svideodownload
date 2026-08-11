"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  BadgeCheck,
  Check,
  CheckCircle2,
  Download,
  Eye,
  Heart,
  ImageIcon,
  Loader2,
  Music,
  Play,
  ShieldCheck,
  UserX,
  Video,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { BatchAdGate } from "@/features/downloader/batch-ad-gate";
import { startDownload as enqueueDownload } from "@/features/downloads/manager";
import { ResultAd } from "@/features/monetization/result-ad";
import { RewardedAdGate } from "@/features/monetization/rewarded-ad";
import { rewardAdsFor, type RewardAd } from "@/lib/monetization/reward-policy";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { cn, formatBytes, formatCompactNumber, formatDuration } from "@/lib/utils";
import type { MediaFormat, MediaKind, VideoMetadata } from "@/types";

type DownloadPhase = "idle" | "working" | "done";

interface PreviewCardProps {
  metadata: VideoMetadata;
  phase: DownloadPhase;
  onDownload: (formatId: string, kind: MediaKind) => void;
}

export function PreviewCard({ metadata, phase, onDownload }: PreviewCardProps) {
  const videoFormats = useMemo(
    () => metadata.formats.filter((f) => f.kind === "video"),
    [metadata.formats],
  );
  const audioFormats = useMemo(
    () => metadata.formats.filter((f) => f.kind === "audio"),
    [metadata.formats],
  );
  const imageFormats = useMemo(
    () => metadata.formats.filter((f) => f.kind === "image"),
    [metadata.formats],
  );

  const listFor = (k: MediaKind) =>
    k === "video" ? videoFormats : k === "image" ? imageFormats : audioFormats;

  const [tab, setTab] = useState<MediaKind>(
    videoFormats.length > 0 ? "video" : imageFormats.length > 0 ? "image" : "audio",
  );
  const formats = listFor(tab);
  const [activeId, setActiveId] = useState<string>(formats[0]?.formatId ?? "best");

  const onTabChange = (next: MediaKind) => {
    setTab(next);
    setActiveId(listFor(next)[0]?.formatId ?? "best");
  };

  // ── Batch download — multi-photo posts and multi-snap stories ──────────
  // Premium selection grid per the design: numbered tiles, animated checkmarks,
  // Select All, live counter + total size, one button downloads everything in
  // the background (each item streams through the download manager).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [metadata.id]);

  /*
    What can be batch-downloaded.

    Two cases, both "these are distinct pieces of media, not alternatives":
      · a multi-photo post — more than one image format (the original case), and
      · anything an extractor explicitly flagged `isSeparateItem`, which is how
        a Snapchat story with several snaps arrives.

    ── Separate items are read from EVERY format, not the active tab ────────
    Owner (2026-08-09), with a link: a story fetched only one snap. The
    extractor returned all three — verified against the live page — but this
    line filtered the TAB'S list, and that story was one video plus two photos.
    On the Video tab exactly one separate item survived, so `isBatchable` was
    false and the whole story collapsed to a single download; on Photos it
    would have offered two and silently lost the video.

    The tabs exist to choose a QUALITY of one item, which is a question that
    does not apply to separate items: a story is one collection whether its
    snaps are video, photo or both. So they are collected from all formats and
    the grid offers the entire story, each tile carrying its own kind.

    Multi-photo posts are unchanged — an image tab with more than one image
    still batches through the second branch.
  */
  const separateItems = useMemo(
    () => metadata.formats.filter((f) => f.isSeparateItem),
    [metadata.formats],
  );
  const batchItems = separateItems.length > 1 ? separateItems : tab === "image" ? imageFormats : [];
  const isBatchable = batchItems.length > 1;
  const toggleSelect = (formatId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(formatId)) next.delete(formatId);
      else next.add(formatId);
      return next;
    });
  const allSelected = isBatchable && selected.size === batchItems.length;
  const batchBytes = batchItems.reduce((n, f) => (selected.has(f.formatId) ? n + (f.filesize ?? 0) : n), 0);
  /*
    ── Batch is free, and an ad pays for it (owner, 2026-08-09) ────────────
    It used to be a Pro wall. An upgrade prompt earns nothing from the people
    who will never buy; it just takes the feature away. So the batch is queued
    behind a full-screen ad and runs the moment that ad is dismissed — and it
    runs regardless if the slot is empty, the config never loaded, or the
    member is premium.
  */
  const [pendingBatch, setPendingBatch] = useState<typeof batchItems | null>(null);
  const [batchFinished, setBatchFinished] = useState(false);

  /** Queue the items and let the gate decide whether an ad runs first. */
  const batchDownload = (explicit?: typeof batchItems) => {
    setPendingBatch(explicit ?? batchItems.filter((f) => selected.has(f.formatId)));
  };

  /** Actually enqueue — called by the gate once the ad (if any) is done. */
  const runBatch = (items: typeof batchItems) => {
    /*
      ONE id for the whole batch (owner, 2026-08-09: "multiple download should
      be recorded as one in the free user daily limit for download but not the
      rest api request").

      A story or a slideshow is many files but ONE thing the member asked for.
      The daily cap was charged per FILE, so a 12-photo TikTok slideshow spent
      12 of a free visitor's 30 — and once the cap ran out mid-batch the
      remaining files came back 429 while the earlier ones had already
      succeeded. That is the reported "some failed in the multiple download".

      Every item carries this id; the server writes one receipt against it and
      charges once. The API requests themselves are untouched — each file still
      needs its own extraction and transfer.
    */
    const batchId = crypto.randomUUID();
    items.forEach((f, i) => {
      // Each item carries its OWN kind — a story can mix video snaps and photo
      // snaps, and sending them all as "image" would have saved the videos with
      // the wrong extension.
      enqueueDownload({
        url: metadata.sourceUrl,
        formatId: f.formatId,
        kind: f.kind,
        title: `${metadata.title || "download"} · ${i + 1} of ${items.length}`,
        thumbnail: f.thumbnail ?? (f.kind === "image" ? f.directUrl : null) ?? metadata.thumbnail,
        platform: metadata.platform,
        platformName: metadata.platformName,
        qualityLabel: f.label,
        durationSeconds: metadata.durationSeconds,
        batchId,
      });
    });
    // No "started" toast — the floating card shows "Downloading N items…".
    setSelected(new Set());
    // The closing ad fires AFTER the files are queued, so dismissing it can
    // never cost the member their download.
    setBatchFinished(true);
  };

  /*
    ── One is free, many is Pro (owner, 2026-08-04) ────────────────────────
    Removing the `isImageTab` gate earlier made ANY selection take the batch
    path, so ticking a single video asked a free member to upgrade to download
    one file — which they could already do by just pressing the button.

    The line is now where the value actually is: picking one item is an
    ordinary download and stays free; picking several is the feature worth
    paying for. A single tick therefore downloads THAT item rather than
    whatever the active row happens to be, which is also what tapping a tile
    plainly means.
  */
  const runDownload = () => {
    // Nothing ticked on a multi-item link means "give me the lot" — that is
    // what a story link asks for, and it is the action the button advertises.
    if (isBatchable && selected.size === 0) {
      batchDownload(batchItems);
      return;
    }
    if (isBatchable && selected.size > 1) {
      batchDownload();
      return;
    }
    if (isBatchable && selected.size === 1) {
      const only = batchItems.find((f) => selected.has(f.formatId));
      if (only) {
        startDownload(only.formatId, only.kind);
        return;
      }
    }
    startDownload(activeId, tab);
  };

  const activeFormat = formats.find((f) => f.formatId === activeId);

  /*
    ── 🔴 THE REWARD GATE IS BY FILE SIZE NOW (owner, 2026-08-11) ────────────
    "downloads above 100mb [a 30 sec reward ad], more than 500mb should show a
    first 30 sec reward ad and after it finishes another 30 sec reward ad but
    can be skipable after 15 secs."

    It used to be `kind === "image" || formatId === topVideoId` — the
    highest-RANKED format, with no reference to size. On the 60-minute video that
    prompted this it was wrong in both directions at once: 720p is 1.03 GB and is
    NOT the top format, so a gigabyte went through ungated, while a 15-second
    clip's top format is a few MB and WAS gated. Cost scales with bytes, so the
    gate is bytes. The policy and its thresholds live in
    lib/monetization/reward-policy.ts with the tests.

    `queue` holds the ads still to watch. Draining it one at a time — rather than
    rendering two gates or nesting them — is what makes "after it finishes, show
    another" literal, and it means the second ad's own props (its skip window)
    come from the policy rather than from a flag threaded through the component.
  */
  const { showAds } = useShowAds();
  const [gate, setGate] = useState<{ formatId: string; kind: MediaKind } | null>(null);
  const [queue, setQueue] = useState<RewardAd[]>([]);
  const [totalAds, setTotalAds] = useState(0);
  const startDownload = (formatId: string, kind: MediaKind) => {
    const fmt = formats.find((f) => f.formatId === formatId && f.kind === kind);
    const ads = rewardAdsFor({ filesize: fmt?.filesize ?? null, showAds, kind });
    if (ads.length > 0) {
      setQueue(ads);
      setTotalAds(ads.length);
      setGate({ formatId, kind });
      return;
    }
    onDownload(formatId, kind);
  };

  /*
    How many ads the CURRENT selection would cost — drives the button's amber
    treatment, so the colour is a promise the gate actually keeps. It was
    previously `needsReward(activeId, tab)`, which asked the old rank-based rule
    and so lit up for the wrong formats in both directions.
  */
  const gatedAdCount = useMemo(() => {
    const fmt = formats.find((f) => f.formatId === activeId && f.kind === tab);
    return rewardAdsFor({ filesize: fmt?.filesize ?? null, showAds, kind: tab }).length;
  }, [formats, activeId, tab, showAds]);

  const platform = PLATFORMS[metadata.platform];
  const BrandIcon = BRAND_ICONS[metadata.platform];

  // Live cover: when browsing photos, mirror the selected photo; otherwise show
  // the video poster, falling back to any available image so every fetch — image
  // OR video — always shows a cover.
  const firstImage = imageFormats.find((f) => f.directUrl)?.directUrl ?? null;
  const cover =
    (tab === "image" ? activeFormat?.directUrl : null) ??
    metadata.thumbnail ??
    firstImage ??
    null;

  const isImageTab = tab === "image";
  const photoIndex = isImageTab ? imageFormats.findIndex((f) => f.formatId === activeId) : -1;

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="group/card relative mx-auto mt-10 w-full max-w-2xl overflow-hidden rounded-[2rem] border border-border/60 bg-card shadow-luxury"
    >
      {/* subtle gradient sheen on top edge */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r opacity-70",
          platform.accent,
        )}
      />

      {/* ---------------- Media cover ---------------- */}
      <div className="relative aspect-video overflow-hidden bg-neutral-950">
        {/* blurred fill so portrait/square media frames elegantly */}
        <AnimatePresence mode="popLayout">
          {cover ? (
            <motion.div
              key={cover}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="absolute inset-0"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cover}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cover}
                alt={metadata.title}
                className="absolute inset-0 h-full w-full object-contain"
              />
            </motion.div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-white/25">
              {BrandIcon ? <BrandIcon className="h-16 w-16" /> : <Video className="h-14 w-14" />}
            </div>
          )}
        </AnimatePresence>

        {/* legibility gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/40" />

        {/* center play (video only) */}
        {tab === "video" ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="absolute h-16 w-16 rounded-full bg-white/20 blur-md" />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/95 shadow-2xl ring-1 ring-black/5 transition-transform duration-300 group-hover/card:scale-105">
              <Play className="h-6 w-6 translate-x-0.5 fill-black text-black" />
            </div>
          </div>
        ) : null}

        {/* photo counter (image only) */}
        {isImageTab && imageFormats.length > 1 ? (
          <span className="absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur-md">
            {photoIndex + 1} / {imageFormats.length}
          </span>
        ) : null}

        {/* brand badge */}
        <span
          className={cn(
            "absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br px-3 py-1.5 text-xs font-semibold text-white shadow-lg",
            platform.accent,
          )}
        >
          {BrandIcon ? <BrandIcon className="h-3.5 w-3.5" /> : null}
          {metadata.platformName}
        </span>

        {/* duration / hd chip */}
        <div className="absolute right-4 top-4 flex items-center gap-2">
          {tab === "video" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-md ring-1 ring-white/20">
              <BadgeCheck className="h-3 w-3" /> No watermark
            </span>
          ) : null}
          {tab === "video" && metadata.durationSeconds ? (
            <span className="rounded-md bg-black/65 px-2 py-0.5 text-xs font-semibold tabular-nums text-white backdrop-blur-md">
              {formatDuration(metadata.durationSeconds)}
            </span>
          ) : null}
        </div>

        {/* title + meta overlay */}
        <div className="absolute inset-x-0 bottom-0 p-5">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug text-white drop-shadow sm:text-lg">
            {metadata.title}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/75">
            {metadata.creator ? (
              <span className="inline-flex max-w-[12rem] items-center gap-1 truncate font-medium text-white/90">
                @{metadata.creator.replace(/^@/, "")}
              </span>
            ) : null}
            {metadata.viewCount != null ? (
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" /> {formatCompactNumber(metadata.viewCount)}
              </span>
            ) : null}
            {metadata.likeCount != null ? (
              <span className="inline-flex items-center gap-1">
                <Heart className="h-3.5 w-3.5" /> {formatCompactNumber(metadata.likeCount)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* thumbnail strip for multi-photo posts */}
      {isImageTab && imageFormats.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-b border-border/60 bg-secondary/30 px-4 py-3">
          {imageFormats.map((f, i) => (
            <button
              key={f.formatId}
              type="button"
              onClick={() => setActiveId(f.formatId)}
              className={cn(
                "relative h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-2 transition",
                f.formatId === activeId
                  ? "ring-primary"
                  : "ring-transparent opacity-60 hover:opacity-100",
              )}
              aria-label={`Photo ${i + 1}`}
            >
              {f.directUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.directUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                  <ImageIcon className="h-4 w-4" />
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {/* ---------------- Controls ---------------- */}
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-medium text-muted-foreground">
            Choose {isImageTab ? "photo" : "quality"}
          </span>
          <div className="inline-flex rounded-xl bg-secondary p-1">
            {videoFormats.length > 0 ? (
              <TabButton active={tab === "video"} onClick={() => onTabChange("video")}>
                <Video className="h-4 w-4" /> Video
              </TabButton>
            ) : null}
            {imageFormats.length > 0 ? (
              <TabButton active={tab === "image"} onClick={() => onTabChange("image")}>
                <ImageIcon className="h-4 w-4" /> Photos
              </TabButton>
            ) : null}
            {audioFormats.length > 0 ? (
              <TabButton active={tab === "audio"} onClick={() => onTabChange("audio")}>
                <Music className="h-4 w-4" /> Audio
              </TabButton>
            ) : null}
          </div>
        </div>

        {/*
          The download-result placement, between the "Choose quality" header and
          the quality grid.

          Deliberately INSIDE the card rather than below it, which is where it
          used to sit. Here it is in the one place the visitor is certain to
          look — they have a result and are picking a format — while still being
          above the action rather than in front of it, so it never stands
          between them and the download button.

          Renders nothing at all when the zone is unseeded or, for AdSense, when
          the unit comes back unfilled.
        */}
        <ResultAd className="mt-4" />

        {isBatchable ? (
          /*
            ── The multi-select panel, built to public/mulitpleselection modal.jpg ──
            Owner: "make it look exactly like it and more professional and
            arranged and less cluttered."

            The reference's arrangement, and the reasoning where it differs:

            • ONE panel with its own surface and border, instead of controls
              floating loose on the card. The header, the grid and the count
              read as a single tool you are operating rather than three
              unrelated rows.

            • FOUR columns, as drawn. At four a tile is small, which is exactly
              why the number moved to a corner badge and the tick to the
              opposite one — the middle of the tile stays the picture.

            • The centred play button is gone. At this size it covered most of
              the frame it was describing; a video now says so with a small
              corner glyph, which is the same information and none of the
              obstruction.

            • No PRO chip. The reference has one, but batch downloads are free
              now and paid for by an ad, so badging them Pro would advertise a
              wall that no longer exists (owner, earlier the same day).
          */
          <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-secondary/25">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3.5 py-3">
              <p className="text-sm font-bold">
                Select items{" "}
                <span className="font-semibold text-muted-foreground tabular-nums">
                  ({selected.size}/{batchItems.length})
                </span>
              </p>
              <button
                type="button"
                onClick={() => setSelected(allSelected ? new Set() : new Set(batchItems.map((f) => f.formatId)))}
                className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-violet-500 transition hover:text-violet-400 active:scale-95"
              >
                {allSelected ? "Deselect all" : "Select all"}
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border transition",
                    allSelected
                      ? "border-transparent bg-gradient-to-br from-blue-600 to-violet-600 text-white"
                      : "border-border text-transparent",
                  )}
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              </button>
            </div>

            <div className="grid max-h-[19rem] grid-cols-4 gap-2 overflow-y-auto p-3">
              {batchItems.map((f, i) => {
                const on = selected.has(f.formatId);
                return (
                  <button
                    key={f.formatId}
                    type="button"
                    onClick={() => {
                      setActiveId(f.formatId);
                      toggleSelect(f.formatId);
                    }}
                    aria-pressed={on}
                    aria-label={`${f.label || `Item ${i + 1}`}${on ? " selected" : ""}`}
                    className={cn(
                      "group/tile relative aspect-square overflow-hidden rounded-xl ring-2 transition-all active:scale-[0.96]",
                      on ? "shadow-lg shadow-violet-500/20 ring-violet-500" : "ring-border/60 hover:ring-foreground/25",
                    )}
                  >
                    {/*
                      Each item's OWN poster first (owner, 2026-08-04: "each
                      media should show their respective cover and not a general
                      cover"). An extractor that supplies one — Snapchat sends a
                      `mediaPreviewUrl` per snap — makes the grid usable; without
                      it every tile in a 6-snap story was the same picture and
                      choosing between them was guesswork.

                      Then an IMAGE item's own URL, which IS its picture. A video
                      item's directUrl is an mp4, so it never becomes an <img> —
                      that renders as a broken tile.
                    */}
                    {f.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : f.kind === "image" && f.directUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.directUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : metadata.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={metadata.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                        {f.kind === "video" ? <Video className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
                      </span>
                    )}

                    {/* Unselected tiles dim slightly, so what IS selected reads
                        at a glance without having to find four small ticks. */}
                    <span
                      aria-hidden
                      className={cn(
                        "pointer-events-none absolute inset-0 transition",
                        on ? "bg-transparent" : "bg-black/25",
                      )}
                    />

                    <span className="absolute left-1 top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-black/65 px-1 text-[10px] font-bold tabular-nums text-white backdrop-blur">
                      {i + 1}
                    </span>

                    <span
                      aria-hidden
                      className={cn(
                        "absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full transition duration-200",
                        on
                          ? "scale-100 bg-gradient-to-br from-blue-600 to-violet-600 text-white opacity-100 shadow"
                          : "scale-75 bg-black/35 text-white/70 opacity-90 ring-1 ring-inset ring-white/40",
                      )}
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>

                    {/* A video says so in a corner rather than under a badge
                        covering the frame. */}
                    {f.kind === "video" ? (
                      <span className="pointer-events-none absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                        <Play className="h-2.5 w-2.5 fill-white" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid max-h-44 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
            {formats.map((f, i) => (
              <FormatRow
                key={f.formatId}
                format={f}
                index={i}
                kind={tab}
                active={f.formatId === activeId}
                onSelect={() => setActiveId(f.formatId)}
              />
            ))}
          </div>
        )}

        <button
          type="button"
          disabled={phase !== "idle"}
          onClick={() => runDownload()}
          className={cn(
            "group relative mt-5 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl px-4 py-4 text-base font-semibold shadow-lg transition-all active:scale-[0.99] disabled:active:scale-100",
            phase === "done"
              ? "bg-emerald-600 text-white shadow-emerald-600/25"
              : isBatchable && selected.size !== 1
                ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-violet-500/30 hover:shadow-violet-500/50 hover:shadow-xl disabled:opacity-70"
                : gatedAdCount > 0
                  ? "bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 text-white shadow-amber-500/30 hover:shadow-amber-500/50 hover:shadow-xl disabled:opacity-70"
                  : "bg-primary text-primary-foreground shadow-primary/25 hover:shadow-glow-blue disabled:opacity-70",
          )}
        >
          {/* shimmer sweep */}
          <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          {phase === "working" ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Preparing your file…
            </>
          ) : phase === "done" ? (
            <>
              <CheckCircle2 className="h-5 w-5" /> Download started — check your files
            </>
          ) : isBatchable && selected.size === 0 ? (
            <>
              <Download className="h-5 w-5 transition-transform group-hover:translate-y-0.5" />
              Download all {batchItems.length} {batchItems.every((f) => f.kind === "video") ? "videos" : "items"}
            </>
          ) : isBatchable && selected.size > 1 ? (
            <>
              <Download className="h-5 w-5 transition-transform group-hover:translate-y-0.5" />
              Download {selected.size} Items
            </>
          ) : (
            <>
              <Download className="h-5 w-5 transition-transform group-hover:translate-y-0.5" />
              {isImageTab
                ? `Download Photo${imageFormats.length > 1 ? ` ${photoIndex + 1}` : ""}`
                : `Download ${activeFormat?.label ?? (tab === "audio" ? "Audio" : "Video")}`}
            </>
          )}
        </button>

        <p className="mt-3 text-center text-xs text-muted-foreground">
          {phase === "done"
            ? "Saving to your device — check your browser downloads or Files app."
            : isBatchable && selected.size > 1 && batchBytes > 0
              ? `Total size: ~${formatBytes(batchBytes)}`
              : "Fast, private & free — no app, no sign-up."}
        </p>

        {/*
          Feature strip — what every download gets.

          One quiet inline row, as in the reference (public/mulitpleselection
          modal.jpg), rather than the bordered four-cell table it was. Same four
          claims, none dropped: they are reassurance you read once, and giving
          them a box, dividers and a background made them compete with the
          download button directly above for the same attention.

          Every one is a checkable product fact — no counts, no ratings.
        */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-muted-foreground">
          {(
            [
              { icon: Zap, label: "Lightning fast" },
              { icon: ShieldCheck, label: "Private & secure" },
              { icon: Ban, label: "No watermark" },
              { icon: UserX, label: "No app, no sign-up" },
            ] as const
          ).map(({ icon: Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-[11px] font-medium">
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
              {label}
            </span>
          ))}
        </div>

        {/*
          The "Pro & Above — unlimited batch downloads" upsell is gone (owner,
          2026-08-09): batch is free now, paid for by an ad, so selling it back
          would be advertising a wall that no longer exists. The honest pitch
          moved onto the ad itself, where "skip these" is a real benefit.
        */}
      </div>
    </motion.div>

    {/*
      One gate, driven by the queue. `key` is the reason a SECOND ad actually
      plays: without it React reuses the same mounted component and its internal
      watch timer, so ad two would open already "watched" and grant instantly.
      Keying on the position forces a fresh mount, a fresh fetch and a fresh
      clock — which is what "after it finishes, show another" means.
    */}
    <RewardedAdGate
      key={`reward-${totalAds - queue.length}`}
      open={!!gate && queue.length > 0}
      durationSec={queue[0]?.durationSec ?? 30}
      skipAfterSec={queue[0]?.skipAfterSec ?? null}
      step={totalAds - queue.length + 1}
      totalSteps={totalAds}
      onReward={() => {
        const rest = queue.slice(1);
        setQueue(rest);
        // Only the LAST ad releases the download. Anything else would hand over
        // the file after ad one and leave ad two playing to nobody.
        if (rest.length === 0) {
          if (gate) onDownload(gate.formatId, gate.kind);
          setGate(null);
        }
      }}
      onCancel={() => {
        // ✕ abandons the whole sequence, not just this ad. Dropping the viewer
        // into a second ad they just declined would be the opposite of a close
        // button.
        setQueue([]);
        setGate(null);
      }}
    />

    <BatchAdGate
      pending={pendingBatch !== null}
      onProceed={() => {
        const items = pendingBatch;
        setPendingBatch(null);
        if (items) runBatch(items);
      }}
      onCancel={() => setPendingBatch(null)}
      showComplete={batchFinished}
      onCompleteClosed={() => setBatchFinished(false)}
    />
    </>
  );
}

function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
        active ? "bg-background shadow" : "text-muted-foreground hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}

function FormatRow({
  format,
  index,
  kind,
  active,
  onSelect,
}: {
  format: MediaFormat;
  index: number;
  kind: MediaKind;
  active: boolean;
  onSelect: () => void;
}) {
  const label =
    kind === "image" ? `Photo ${index + 1}` : format.label || (kind === "audio" ? "Audio" : "Video");
  /*
    ── The size has to be the size you actually get (owner, 2026-08-09) ───────
    "Make the file size in the quality review accurate according to the file
    size exactly, and not showing a small file size in review while the main
    size is higher."

    A number is printed ONLY for a format we hand over byte-for-byte. Two kinds
    of format are not that, and both used to show a figure that described a file
    nobody would ever receive:

    • a stream we must RE-ENCODE (TikTok's H.265 "best quality") — measured on
      the owner's link, it advertised 16.4 MB and delivered 43.4 MB, because the
      figure came from the H.265 source and we ship H.264;
    • a synthesized lower tier, which is produced by downscaling at download
      time and therefore has no size until it exists.

    Neither can be known in advance without encoding the file first, so each
    says what it IS instead of guessing a number. That is more useful than a
    wrong figure and considerably more useful than a blank.
  */
  const willConvert = kind === "video" && format.filesize == null;
  const size =
    kind === "image" ? null : format.filesize != null ? formatBytes(format.filesize) : null;
  const sizeNote = !willConvert
    ? null
    : format.transcodeMaxHeight
      ? "smaller file"
      : "size varies";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98]",
        active
          ? "border-primary/60 bg-primary/10 shadow-sm shadow-primary/10 ring-1 ring-primary/25"
          : "border-border/70 bg-card/80 hover:border-foreground/20 hover:bg-secondary/70",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold uppercase leading-none">
        {label}
        {format.fps && format.fps >= 50 ? (
          <span className="rounded bg-primary/15 px-1 py-0.5 text-[9px] font-bold text-primary">
            {format.fps}
          </span>
        ) : null}
      </span>
      <span className="flex items-center gap-1.5 text-[11px] uppercase text-muted-foreground">
        <span>{format.ext}</span>
        {size && size !== "—" ? (
          <span className="normal-case">· {size}</span>
        ) : sizeNote ? (
          <span className="normal-case italic opacity-80">· {sizeNote}</span>
        ) : null}
      </span>
    </button>
  );
}
