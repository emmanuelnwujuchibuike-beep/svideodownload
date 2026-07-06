"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  BadgeCheck,
  Check,
  CheckCircle2,
  Crown,
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

import { startDownload as enqueueDownload } from "@/features/downloads/manager";
import { RewardedAdGate } from "@/features/monetization/rewarded-ad";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { toast } from "@/features/ui/toast";
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

  // ── Batch download (Pro & Above) — multi-photo posts ────────────────────
  // Premium selection grid per the design: numbered tiles, animated checkmarks,
  // Select All, live counter + total size, one button downloads everything in
  // the background (each item streams through the download manager).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [metadata.id]);
  const isBatchable = imageFormats.length > 1;
  const toggleSelect = (formatId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(formatId)) next.delete(formatId);
      else next.add(formatId);
      return next;
    });
  const allSelected = isBatchable && selected.size === imageFormats.length;
  const batchBytes = imageFormats.reduce((n, f) => (selected.has(f.formatId) ? n + (f.filesize ?? 0) : n), 0);

  const batchDownload = () => {
    if (showAds) {
      toast("Batch download is a Pro & Above feature — see plans below.", "info", { duration: 5000 });
      return;
    }
    const items = imageFormats.filter((f) => selected.has(f.formatId));
    items.forEach((f, i) => {
      enqueueDownload({
        url: metadata.sourceUrl,
        formatId: f.formatId,
        kind: "image",
        title: `${metadata.title || "photo"} · ${i + 1} of ${items.length}`,
        thumbnail: f.directUrl ?? metadata.thumbnail,
        platform: metadata.platform,
        platformName: metadata.platformName,
        qualityLabel: "Image",
      });
    });
    // No "started" toast — the floating card shows "Downloading N items…".
    setSelected(new Set());
  };

  const activeFormat = formats.find((f) => f.formatId === activeId);

  // Rewarded-ad gate for high-quality downloads (highest-res video + any image).
  // Free users watch a short ad; premium users (showAds=false) skip it.
  const { showAds } = useShowAds();
  const [gate, setGate] = useState<{ formatId: string; kind: MediaKind } | null>(null);
  const topVideoId = videoFormats[0]?.formatId;
  const needsReward = (formatId: string, kind: MediaKind) =>
    showAds && (kind === "image" || (kind === "video" && formatId === topVideoId));
  const startDownload = (formatId: string, kind: MediaKind) => {
    if (needsReward(formatId, kind)) setGate({ formatId, kind });
    else onDownload(formatId, kind);
  };

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

        {isImageTab && isBatchable ? (
          <div className="mt-4">
            {/* Select items header — count + Select All (Pro & Above batch) */}
            <div className="mb-2.5 flex items-center justify-between">
              <p className="text-sm font-semibold">
                Select items{" "}
                <span className="font-normal text-muted-foreground">
                  ({selected.size}/{imageFormats.length})
                </span>
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  <Crown className="h-3 w-3" /> Pro
                </span>
              </p>
              <button
                type="button"
                onClick={() => setSelected(allSelected ? new Set() : new Set(imageFormats.map((f) => f.formatId)))}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-500 transition hover:text-violet-400"
              >
                {allSelected ? "Deselect All" : "Select All"}
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full border transition",
                    allSelected ? "border-transparent bg-gradient-to-br from-blue-600 to-violet-600 text-white" : "border-border text-transparent",
                  )}
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              </button>
            </div>

            {/* Numbered selection grid — tap toggles; also previews the photo */}
            <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto pr-1">
              {imageFormats.map((f, i) => {
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
                    aria-label={`Photo ${i + 1}${on ? " selected" : ""}`}
                    className={cn(
                      "group/tile relative aspect-square overflow-hidden rounded-2xl ring-2 transition-all active:scale-[0.97]",
                      on ? "ring-violet-500 shadow-lg shadow-violet-500/20" : "ring-border/60 hover:ring-foreground/25",
                    )}
                  >
                    {f.directUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.directUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                        <ImageIcon className="h-5 w-5" />
                      </span>
                    )}
                    {/* number badge */}
                    <span className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-md bg-black/60 px-1 text-[10px] font-bold text-white backdrop-blur">
                      {i + 1}
                    </span>
                    {/* animated check */}
                    <motion.span
                      initial={false}
                      animate={on ? { scale: 1, opacity: 1 } : { scale: 0.5, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 26 }}
                      className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md"
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </motion.span>
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
          onClick={() =>
            isImageTab && isBatchable && selected.size > 0 ? batchDownload() : startDownload(activeId, tab)
          }
          className={cn(
            "group relative mt-5 inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-2xl px-4 py-4 text-base font-semibold shadow-lg transition-all active:scale-[0.99] disabled:active:scale-100",
            phase === "done"
              ? "bg-emerald-600 text-white shadow-emerald-600/25"
              : isImageTab && isBatchable && selected.size > 0
                ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-violet-500/30 hover:shadow-violet-500/50 hover:shadow-xl disabled:opacity-70"
                : needsReward(activeId, tab)
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
          ) : isImageTab && isBatchable && selected.size > 0 ? (
            <>
              <Download className="h-5 w-5 transition-transform group-hover:translate-y-0.5" />
              Download {selected.size} Item{selected.size > 1 ? "s" : ""}
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
            : isImageTab && isBatchable && selected.size > 0 && batchBytes > 0
              ? `Total size: ~${formatBytes(batchBytes)}`
              : "Fast, private & free — no app, no sign-up."}
        </p>

        {/* Feature strip — what every download gets */}
        <div className="mt-4 grid grid-cols-4 divide-x divide-border/60 rounded-2xl border border-border/60 bg-card/60 py-3 text-center">
          {(
            [
              { icon: Zap, label: "Fast Download" },
              { icon: ShieldCheck, label: "Private & Secure" },
              { icon: Ban, label: "No Watermark" },
              { icon: UserX, label: "No Sign-up" },
            ] as const
          ).map(({ icon: Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-1 px-1">
              <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.9} />
              <span className="text-[10px] font-medium leading-tight text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        {/* Pro & Above — batch is a premium capability */}
        {isImageTab && isBatchable && showAds ? (
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-3.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/25">
              <Crown className="h-[18px] w-[18px]" />
            </span>
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">Pro &amp; Above</span> — unlimited batch downloads, high
              quality, no ads and more.
            </p>
            <Link
              href="/pricing"
              className="shrink-0 rounded-xl bg-secondary px-3 py-2 text-xs font-semibold transition hover:bg-secondary/70"
            >
              Learn More
            </Link>
          </div>
        ) : null}
      </div>
    </motion.div>

    <RewardedAdGate
      open={!!gate}
      onReward={() => {
        if (gate) onDownload(gate.formatId, gate.kind);
        setGate(null);
      }}
      onCancel={() => setGate(null)}
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
  // Size shown only when known — never a misleading "—" or an inflated guess.
  const size = kind === "image" ? null : formatBytes(format.filesize);
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
        {size && size !== "—" ? <span className="normal-case">· {size}</span> : null}
      </span>
    </button>
  );
}
