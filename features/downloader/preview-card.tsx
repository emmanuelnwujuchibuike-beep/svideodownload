"use client";

import { motion } from "framer-motion";
import { Download, ImageIcon, Music, Play, Video, Loader2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { cn, formatBytes, formatCompactNumber, formatDuration } from "@/lib/utils";
import type { MediaFormat, MediaKind, VideoMetadata } from "@/types";

interface PreviewCardProps {
  metadata: VideoMetadata;
  downloading: boolean;
  onDownload: (formatId: string, kind: MediaKind) => void;
}

export function PreviewCard({ metadata, downloading, onDownload }: PreviewCardProps) {
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

  const activeFormat = formats.find((f) => f.formatId === activeId);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto mt-10 w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-card shadow-elevated"
    >
      {/* Media preview */}
      <div className="relative aspect-video bg-black">
        {metadata.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={metadata.thumbnail}
            alt={metadata.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/40">
            <Video className="h-12 w-12" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/30" />

        {/* Center play */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-xl backdrop-blur">
            <Play className="h-5 w-5 translate-x-0.5 fill-black text-black" />
          </div>
        </div>

        {/* Platform + duration chips */}
        <span className="absolute left-4 top-4 inline-flex items-center rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white backdrop-blur">
          {metadata.platformName}
        </span>
        {metadata.durationSeconds ? (
          <span className="absolute bottom-4 right-4 rounded-md bg-black/70 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
            {formatDuration(metadata.durationSeconds)}
          </span>
        ) : null}

        {/* Title overlay */}
        <div className="absolute inset-x-0 bottom-0 p-4 pr-24">
          <h3 className="line-clamp-2 text-base font-semibold leading-snug text-white">
            {metadata.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/70">
            {metadata.creator ? <span className="truncate">{metadata.creator}</span> : null}
            {metadata.viewCount != null ? (
              <span>{formatCompactNumber(metadata.viewCount)} views</span>
            ) : null}
            {metadata.likeCount != null ? (
              <span>{formatCompactNumber(metadata.likeCount)} likes</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Choose format
          </span>
          <div className="inline-flex rounded-xl bg-secondary p-1">
            <TabButton
              active={tab === "video"}
              disabled={videoFormats.length === 0}
              onClick={() => onTabChange("video")}
            >
              <Video className="h-4 w-4" /> Video
            </TabButton>
            {imageFormats.length > 0 ? (
              <TabButton active={tab === "image"} onClick={() => onTabChange("image")}>
                <ImageIcon className="h-4 w-4" /> Photos
              </TabButton>
            ) : null}
            <TabButton
              active={tab === "audio"}
              disabled={audioFormats.length === 0}
              onClick={() => onTabChange("audio")}
            >
              <Music className="h-4 w-4" /> Audio
            </TabButton>
          </div>
        </div>

        <div className="mt-4 grid max-h-44 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
          {formats.map((f) => (
            <FormatRow
              key={f.formatId}
              format={f}
              active={f.formatId === activeId}
              onSelect={() => setActiveId(f.formatId)}
            />
          ))}
        </div>

        <button
          type="button"
          disabled={downloading}
          onClick={() => onDownload(activeId, tab)}
          className="group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:shadow-primary/40 active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100"
        >
          {downloading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Preparing your file…
            </>
          ) : (
            <>
              <Download className="h-5 w-5 transition-transform group-hover:translate-y-0.5" />
              Download {activeFormat?.label ?? (tab === "audio" ? "Audio" : "Video")}
              {activeFormat?.filesize ? (
                <span className="text-primary-foreground/70">
                  · {formatBytes(activeFormat.filesize)}
                </span>
              ) : null}
            </>
          )}
        </button>
      </div>
    </motion.div>
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
  active,
  onSelect,
}: {
  format: MediaFormat;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98]",
        active
          ? "border-primary bg-primary/10 ring-1 ring-primary/30"
          : "border-border bg-card hover:border-foreground/20 hover:bg-secondary/60",
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-semibold uppercase leading-none">
        {format.label}
        {format.fps && format.fps >= 50 ? (
          <span className="rounded bg-primary/15 px-1 py-0.5 text-[9px] font-bold text-primary">
            {format.fps}
          </span>
        ) : null}
      </span>
      <span className="text-[11px] uppercase text-muted-foreground">
        {format.ext}
        {format.filesize ? ` · ${formatBytes(format.filesize)}` : ""}
      </span>
    </button>
  );
}
