"use client";

import { addDownload } from "@/features/history/store";
import { saveBlob } from "@/lib/client-download";
import type { MediaKind, PlatformId } from "@/types";

/**
 * In-app download manager: streams `/api/download` so we can show real progress,
 * speed, and pause / resume / cancel / retry — backing the Downloads dashboard.
 * Completed files are saved to disk and recorded in the history store. Module-
 * level + `useSyncExternalStore` so any component observes the same queue.
 *
 * Note: pause/resume restart the transfer (the stream endpoint isn't range-
 * resumable); cancel aborts and drops it. On iOS Safari, where in-app blob
 * saves are unreliable, callers should fall back to a native link.
 */

export type TaskStatus = "queued" | "downloading" | "paused" | "completed" | "failed" | "canceled";

export interface DownloadTask {
  id: string;
  url: string;
  formatId: string;
  kind: MediaKind;
  title: string;
  thumbnail: string | null;
  platform: PlatformId;
  platformName: string;
  qualityLabel: string;
  status: TaskStatus;
  receivedBytes: number;
  totalBytes: number;
  /** bytes/sec (smoothed) */
  speed: number;
  error: string | null;
  createdAt: number;
}

let tasks: DownloadTask[] = [];
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function emit() {
  tasks = [...tasks];
  for (const l of listeners) l();
}
function patch(id: string, next: Partial<DownloadTask>) {
  const i = tasks.findIndex((t) => t.id === id);
  if (i === -1) return;
  tasks[i] = { ...tasks[i]!, ...next };
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getSnapshot(): DownloadTask[] {
  return tasks;
}
const EMPTY: DownloadTask[] = [];
export function getServerSnapshot(): DownloadTask[] {
  return EMPTY;
}

function buildUrl(t: Pick<DownloadTask, "url" | "formatId" | "kind" | "title">): string {
  const sp = new URLSearchParams({ url: t.url, formatId: t.formatId, kind: t.kind, title: t.title });
  return `/api/download?${sp.toString()}`;
}

async function run(id: string) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const controller = new AbortController();
  controllers.set(id, controller);
  patch(id, { status: "downloading", error: null, receivedBytes: 0, speed: 0 });

  try {
    const res = await fetch(buildUrl(task), { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get("content-length")) || 0;
    patch(id, { totalBytes: total });
    const contentType = res.headers.get("content-type") || "application/octet-stream";

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    let lastT = performance.now();
    let lastBytes = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        const now = performance.now();
        if (now - lastT > 400) {
          const speed = ((received - lastBytes) / (now - lastT)) * 1000;
          patch(id, { receivedBytes: received, speed });
          lastT = now;
          lastBytes = received;
        }
      }
    }

    const blob = new Blob(chunks as BlobPart[], { type: contentType });
    const ext = contentType.includes("audio") ? "mp3" : contentType.includes("image") ? "jpg" : "mp4";
    saveBlob(blob, `${task.title || "download"}.${ext}`);

    patch(id, { status: "completed", receivedBytes: received, totalBytes: total || received, speed: 0 });
    addDownload({
      url: task.url,
      platform: task.platform,
      platformName: task.platformName,
      title: task.title,
      thumbnail: task.thumbnail,
      formatId: task.formatId,
      kind: task.kind,
      qualityLabel: task.qualityLabel,
    });
  } catch (err) {
    if (controller.signal.aborted) return; // paused/canceled handled elsewhere
    patch(id, { status: "failed", error: err instanceof Error ? err.message : "Download failed" });
  } finally {
    controllers.delete(id);
  }
}

export function startDownload(input: {
  url: string;
  formatId: string;
  kind: MediaKind;
  title: string;
  thumbnail: string | null;
  platform: PlatformId;
  platformName: string;
  qualityLabel: string;
}): string {
  const id = crypto.randomUUID();
  tasks = [
    {
      id,
      ...input,
      status: "queued",
      receivedBytes: 0,
      totalBytes: 0,
      speed: 0,
      error: null,
      createdAt: Date.now(),
    },
    ...tasks,
  ];
  emit();
  void run(id);
  return id;
}

export function pauseDownload(id: string) {
  controllers.get(id)?.abort();
  controllers.delete(id);
  patch(id, { status: "paused", speed: 0 });
}
export function resumeDownload(id: string) {
  void run(id);
}
export function retryDownload(id: string) {
  void run(id);
}
export function cancelDownload(id: string) {
  controllers.get(id)?.abort();
  controllers.delete(id);
  tasks = tasks.filter((t) => t.id !== id);
  emit();
}
export function pauseAll() {
  for (const t of tasks) if (t.status === "downloading") pauseDownload(t.id);
}
export function clearFinished() {
  tasks = tasks.filter((t) => t.status === "downloading" || t.status === "paused" || t.status === "queued");
  emit();
}
