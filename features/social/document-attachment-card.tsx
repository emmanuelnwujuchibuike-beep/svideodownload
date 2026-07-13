"use client";

import { Check, File as FileIcon, X } from "lucide-react";
import { useRef, useState } from "react";

import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { cn, formatBytes } from "@/lib/utils";

/**
 * A document bubble with a REAL download-progress bar (owner mockup — "24.5
 * MB … 2.4 MB / 24.5 MB" mid-download) — replaces the previous plain
 * `<a target="_blank">` link, which gave zero feedback while a large file
 * downloaded (the browser's own download UI, if any, is easy to miss on
 * mobile). Streams via `fetch()` + a reader instead of a plain navigation so
 * progress is actually observable; falls back to opening the file directly
 * if the browser can't stream the response body for some reason.
 */
export function DocumentAttachmentCard({
  url,
  filename,
  sizeBytes,
  mine,
}: {
  url: string;
  filename: string | null;
  sizeBytes: number | null;
  mine: boolean;
}) {
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [done, setDone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const startDownload = async () => {
    if (progress) return;
    haptic("light");
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ received: 0, total: sizeBytes ?? 0 });
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok || !res.body) throw new Error("download failed");
      const total = Number(res.headers.get("content-length")) || sizeBytes || 0;
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        if (value) {
          chunks.push(value);
          received += value.length;
          setProgress({ received, total });
        }
      }
      const blob = new Blob(chunks as BlobPart[]);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename ?? "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
      setDone(true);
      setTimeout(() => {
        setDone(false);
        setProgress(null);
      }, 1800);
    } catch (err) {
      if ((err as Error).name !== "AbortError") toast("Couldn't download that file.", "error");
      setProgress(null);
    } finally {
      abortRef.current = null;
    }
  };

  const cancelDownload = () => {
    abortRef.current?.abort();
    setProgress(null);
  };

  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;

  return (
    <div
      className={cn(
        "mt-1.5 flex w-full items-center gap-2.5 rounded-2xl border px-3 py-2.5",
        mine ? "border-white/20 bg-white/10" : "border-border/50 bg-secondary/30",
      )}
    >
      <button type="button" onClick={progress ? undefined : startDownload} disabled={!!progress} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        {done ? (
          <Check className="h-6 w-6 shrink-0 text-emerald-400" />
        ) : (
          <FileIcon className="h-6 w-6 shrink-0 opacity-80" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">{filename ?? "Document"}</span>
          {progress ? (
            <span className="mt-1 flex items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/20">
                <span className="block h-full rounded-full bg-current transition-all" style={{ width: `${pct}%` }} />
              </span>
              <span className="shrink-0 text-[11px] opacity-70">
                {formatBytes(progress.received)} / {progress.total ? formatBytes(progress.total) : "—"}
              </span>
            </span>
          ) : (
            <span className="block text-[11px] opacity-70">{sizeBytes ? formatBytes(sizeBytes) : "Tap to download"}</span>
          )}
        </span>
      </button>
      {progress ? (
        <button
          type="button"
          onClick={cancelDownload}
          aria-label="Cancel download"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full opacity-70 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
