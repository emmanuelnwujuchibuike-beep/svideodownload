"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Download, FolderDown, Loader2, RotateCcw, Share, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { useUser } from "@/features/auth/use-user";
import {
  cancelDownload,
  dismissTask,
  getServerSnapshot,
  getSnapshot,
  retryDownload,
  saveTaskToDevice,
  subscribe,
  type DownloadTask,
} from "@/features/downloads/manager";
import { cn } from "@/lib/utils";

function fmtBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} GB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)} KB`;
  return `${n} B`;
}

function eta(t: DownloadTask): string | null {
  if (!t.totalBytes || !t.speed || t.speed < 1) return null;
  const s = Math.ceil((t.totalBytes - t.receivedBytes) / t.speed);
  if (s < 1) return null;
  if (s < 60) return `${s}s left`;
  return `${Math.ceil(s / 60)}m left`;
}

// Only one card layer app-wide even if two surfaces mount it (app shell +
// landing downloader) — the first mount wins.
let layerClaimed = false;

/**
 * The floating download card — the "never get stuck on a preview page"
 * experience. Downloads run in the background (streamed, with real progress);
 * this card shows percentage / size / speed / time left wherever the user is,
 * without blocking anything. On completion: desktop/Android auto-save and show
 * a success card; iOS shows "Save to device" (the share sheet — the ONE path
 * that reliably lands a video in Photos/Files from a web app — needs a real
 * tap, so it waits for one here instead of navigating to a Quick Look page).
 */
export function FloatingDownloadProgress() {
  const claimed = useRef(false);
  const tasks = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Where the "Downloads" button lands: the public library for signed-out
  // visitors (no login wall), the full dashboard for signed-in ones.
  const { user } = useUser();
  const downloadsHref = user ? "/downloads" : "/library";

  useEffect(() => {
    if (!layerClaimed) {
      layerClaimed = true;
      claimed.current = true;
      return () => {
        layerClaimed = false;
      };
    }
    return undefined;
  }, []);

  // Auto-dismiss completed cards that need no further action.
  const activeCount = tasks.filter((t) => t.status === "downloading" || t.status === "queued").length;
  const active = tasks.find((t) => t.status === "downloading" || t.status === "queued");
  const finished = tasks.find((t) => t.status === "completed" || t.status === "failed");
  const task = active ?? finished;
  useEffect(() => {
    if (!task || task.status !== "completed" || task.awaitingSave) return;
    const t = setTimeout(() => dismissTask(task.id), 6000);
    return () => clearTimeout(t);
  }, [task]);

  if (!claimed.current || !task) return null;

  const pct = task.totalBytes > 0 ? Math.min(100, Math.round((task.receivedBytes / task.totalBytes) * 100)) : null;
  const remaining = eta(task);

  return (
    <AnimatePresence>
      <motion.div
        key={task.id + task.status}
        initial={{ y: 72, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 72, opacity: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[85] mx-auto max-w-md lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-96"
        role="status"
        aria-live="polite"
      >
        <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/95 p-4 shadow-elevated backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                task.status === "failed"
                  ? "bg-rose-500/15 text-rose-500"
                  : task.status === "completed"
                    ? "bg-emerald-500/15 text-emerald-500"
                    : "bg-gradient-to-br from-blue-600 to-violet-600 text-white",
              )}
            >
              {task.status === "completed" ? (
                <Check className="h-5 w-5" />
              ) : task.status === "failed" ? (
                <X className="h-5 w-5" />
              ) : (
                <Download className="h-5 w-5" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-snug">
                {task.status === "completed"
                  ? task.awaitingSave
                    ? "Ready — save it to your device"
                    : "Download complete"
                  : task.status === "failed"
                    ? "Download failed"
                    : activeCount > 1
                      ? `Downloading ${activeCount} items…`
                      : "Downloading…"}
              </p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{task.title || "Your file"}</p>

              {task.status === "downloading" || task.status === "queued" ? (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                    {pct === null ? (
                      <div className="h-full w-1/3 animate-[shimmer_1.2s_infinite] rounded-full bg-gradient-to-r from-blue-500 to-violet-500" />
                    ) : (
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
                    )}
                  </div>
                  <p className="mt-1.5 flex items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
                    {pct !== null ? <span className="font-semibold text-foreground">{pct}%</span> : <Loader2 className="h-3 w-3 animate-spin" />}
                    <span>
                      {fmtBytes(task.receivedBytes)}
                      {task.totalBytes ? ` / ${fmtBytes(task.totalBytes)}` : ""}
                    </span>
                    {task.speed > 1 ? <span>· {fmtBytes(task.speed)}/s</span> : null}
                    {remaining ? <span>· {remaining}</span> : null}
                  </p>
                </>
              ) : task.status === "failed" ? (
                <p className="mt-1 text-xs text-rose-400">{task.error || "Check your connection and retry."}</p>
              ) : null}

              {/* Actions */}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {task.status === "completed" && task.awaitingSave ? (
                  <button
                    type="button"
                    onClick={() => void saveTaskToDevice(task.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 active:scale-95"
                  >
                    <Share className="h-3.5 w-3.5" /> Save to device
                  </button>
                ) : null}
                {task.status === "completed" ? (
                  <Link
                    href={downloadsHref}
                    prefetch
                    onClick={() => dismissTask(task.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 px-3 py-2 text-xs font-semibold transition hover:bg-secondary"
                  >
                    <FolderDown className="h-3.5 w-3.5" /> Downloads
                  </Link>
                ) : null}
                {task.status === "failed" ? (
                  <button
                    type="button"
                    onClick={() => retryDownload(task.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:opacity-95 active:scale-95"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Retry
                  </button>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              aria-label={task.status === "downloading" ? "Cancel download" : "Dismiss"}
              onClick={() => (task.status === "downloading" || task.status === "queued" ? cancelDownload(task.id) : dismissTask(task.id))}
              className="shrink-0 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
