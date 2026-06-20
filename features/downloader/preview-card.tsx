"use client";

import { motion } from "framer-motion";
import { Download, Music, Video, Loader2 } from "lucide-react";
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

  const [tab, setTab] = useState<MediaKind>(
    videoFormats.length > 0 ? "video" : "audio",
  );
  const formats = tab === "video" ? videoFormats : audioFormats;
  const [activeId, setActiveId] = useState<string>(formats[0]?.formatId ?? "best");

  const onTabChange = (next: MediaKind) => {
    setTab(next);
    const list = next === "video" ? videoFormats : audioFormats;
    setActiveId(list[0]?.formatId ?? "best");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass mx-auto mt-8 w-full max-w-3xl overflow-hidden rounded-2xl"
    >
      <div className="grid gap-0 sm:grid-cols-[200px_1fr]">
        <div className="relative aspect-video bg-black/40 sm:aspect-auto">
          {metadata.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={metadata.thumbnail}
              alt={metadata.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <Video className="h-10 w-10" />
            </div>
          )}
          {metadata.durationSeconds ? (
            <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
              {formatDuration(metadata.durationSeconds)}
            </span>
          ) : null}
        </div>

        <div className="p-5">
          <span className="inline-flex items-center rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
            {metadata.platformName}
          </span>
          <h3 className="mt-2 line-clamp-2 text-lg font-semibold leading-snug">
            {metadata.title}
          </h3>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {metadata.creator ? <span>{metadata.creator}</span> : null}
            {metadata.viewCount != null ? (
              <span>{formatCompactNumber(metadata.viewCount)} views</span>
            ) : null}
            {metadata.likeCount != null ? (
              <span>{formatCompactNumber(metadata.likeCount)} likes</span>
            ) : null}
          </div>

          <div className="mt-4 inline-flex rounded-lg bg-secondary p-1">
            <TabButton active={tab === "video"} disabled={videoFormats.length === 0} onClick={() => onTabChange("video")}>
              <Video className="h-4 w-4" /> Video
            </TabButton>
            <TabButton active={tab === "audio"} disabled={audioFormats.length === 0} onClick={() => onTabChange("audio")}>
              <Music className="h-4 w-4" /> Audio
            </TabButton>
          </div>

          <div className="mt-3 max-h-40 space-y-1.5 overflow-y-auto pr-1">
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
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {downloading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Preparing your file…
              </>
            ) : (
              <>
                <Download className="h-5 w-5" /> Download {tab === "audio" ? "Audio" : "Video"}
              </>
            )}
          </button>
        </div>
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
        "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition",
        active ? "border-primary bg-primary/10" : "border-border hover:bg-secondary",
      )}
    >
      <span className="flex items-center gap-2 font-medium">
        <span className="uppercase">{format.label}</span>
        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
          {format.ext}
        </span>
        {format.fps ? (
          <span className="text-xs text-muted-foreground">{format.fps}fps</span>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground">{formatBytes(format.filesize)}</span>
    </button>
  );
}
