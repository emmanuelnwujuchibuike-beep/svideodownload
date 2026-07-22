"use client";

import { addDownload } from "@/features/history/store";
import { mediaKey, saveMedia } from "@/features/downloads/local-media";
import { toast } from "@/features/ui/toast";
import { isIosDevice, saveBlob, saveToDevice } from "@/lib/client-download";
import { beginCriticalActivity } from "@/lib/pwa/activity-lock";
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
  /** Fetch this exact URL instead of the /api/download pipeline (post media). */
  directUrl?: string;
  /** On iOS the finished file waits for a tap (share sheet needs a gesture). */
  awaitingSave?: boolean;
}

let tasks: DownloadTask[] = [];
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

// A monotonic count of completed downloads this session, with its own listener
// set — the interstitial fires on "3 consecutive downloads" and only needs the
// completion beat, not every progress tick the main `listeners` set emits.
let completedCount = 0;
const completionListeners = new Set<() => void>();
/** Total downloads completed this session (never decremented). */
export function getCompletedCount(): number {
  return completedCount;
}
/** Subscribe to download completions (fires once per finished transfer). */
export function onDownloadCompleted(cb: () => void): () => void {
  completionListeners.add(cb);
  return () => completionListeners.delete(cb);
}
// Finished files kept briefly so the completion card's "Save to device" button
// (iOS — the share sheet requires a user gesture) can hand them over. Capped.
const finishedBlobs = new Map<string, { blob: Blob; filename: string }>();
function retainBlob(id: string, blob: Blob, filename: string) {
  finishedBlobs.set(id, { blob, filename });
  while (finishedBlobs.size > 3) {
    const oldest = finishedBlobs.keys().next().value;
    if (oldest === undefined) break;
    finishedBlobs.delete(oldest);
  }
}

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

/**
 * The blob's MIME type is what iOS's share sheet keys "Save Video"/"Save
 * Image" off — a missing or generic type turns the download into a nameless
 * "file" with no save option. When the source doesn't declare a real type,
 * derive it from what the user asked for.
 */
function normalizeMediaType(raw: string | null, kind: MediaKind): string {
  const t = (raw ?? "").split(";")[0]!.trim().toLowerCase();
  if (t && t !== "application/octet-stream" && t !== "binary/octet-stream") return t;
  return kind === "audio" ? "audio/mpeg" : kind === "image" ? "image/jpeg" : "video/mp4";
}

function extFor(type: string): string {
  if (type.includes("audio")) return type.includes("mp4") || type.includes("m4a") ? "m4a" : "mp3";
  if (type.includes("image")) return type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  return "mp4";
}

async function run(id: string) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const controller = new AbortController();
  controllers.set(id, controller);
  patch(id, { status: "downloading", error: null, receivedBytes: 0, speed: 0 });

  // Held for the actual byte transfer — a service-worker-driven reload mid-
  // download would silently drop it with no way to resume (the stream isn't
  // range-resumable). Released in `finally` below, same lifecycle as the
  // AbortController: pause/cancel/complete/fail all end this `run()` call.
  const endCriticalActivity = beginCriticalActivity();

  try {
    const res = await fetch(task.directUrl ?? buildUrl(task), { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const total = Number(res.headers.get("content-length")) || 0;
    patch(id, { totalBytes: total });
    const contentType = normalizeMediaType(res.headers.get("content-type"), task.kind);

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
    const filename = `${task.title || "download"}.${extFor(contentType)}`;

    // 1) Save into the on-device library so it can be re-watched in the browser
    //    (and published) without re-fetching or visiting the source platform.
    await saveMedia(mediaKey(task.url, task.formatId, task.kind), blob).catch(() => {});
    // 2) Hand the file to the device. On iOS the share sheet ("Save Video")
    //    needs a real tap, so the completion card offers a Save button instead
    //    of navigating anywhere — the user never leaves the app.
    const ios = isIosDevice();
    retainBlob(id, blob, filename);
    if (!ios) saveBlob(blob, filename);

    patch(id, { status: "completed", receivedBytes: received, totalBytes: total || received, speed: 0, awaitingSave: ios });
    completedCount += 1;
    for (const l of completionListeners) l();
    addDownload({
      url: task.url,
      platform: task.platform,
      platformName: task.platformName,
      title: task.title,
      thumbnail: task.thumbnail,
      formatId: task.formatId,
      kind: task.kind,
      qualityLabel: task.qualityLabel,
      size: received, // exact downloaded bytes
    });
    if (!ios) toast("Download complete — saved to your device & library", "success");
  } catch (err) {
    if (controller.signal.aborted) return; // paused/canceled handled elsewhere
    patch(id, { status: "failed", error: err instanceof Error ? err.message : "Download failed" });
    toast("Download failed — tap retry", "error");
  } finally {
    controllers.delete(id);
    endCriticalActivity();
  }
}

/** Hand a finished task's file to the device (call from a TAP — iOS share sheet). */
export async function saveTaskToDevice(id: string): Promise<void> {
  const kept = finishedBlobs.get(id);
  if (!kept) {
    toast("File expired — download it again.", "error");
    return;
  }
  await saveToDevice(kept.blob, kept.filename);
  patch(id, { awaitingSave: false });
}

/** Remove a completed/failed task from the list (the card's dismiss). */
export function dismissTask(id: string) {
  finishedBlobs.delete(id);
  tasks = tasks.filter((t) => t.id !== id);
  emit();
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
  directUrl?: string;
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
  // No "started" toast — the floating progress card IS the notification.
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
  finishedBlobs.delete(id);
  tasks = tasks.filter((t) => t.id !== id);
  emit();
}
export function pauseAll() {
  for (const t of tasks) if (t.status === "downloading") pauseDownload(t.id);
}
export function clearFinished() {
  for (const t of tasks) {
    if (t.status === "completed" || t.status === "failed" || t.status === "canceled") finishedBlobs.delete(t.id);
  }
  tasks = tasks.filter((t) => t.status === "downloading" || t.status === "paused" || t.status === "queued");
  emit();
}
