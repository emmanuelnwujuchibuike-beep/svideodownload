"use client";

import { trackDownload } from "@/lib/analytics/client";
import { addDownload } from "@/features/history/store";
import { getMedia, mediaKey, saveMedia } from "@/features/downloads/local-media";
import { toast } from "@/features/ui/toast";
import { isIosDevice, saveBlob, saveFilesToDevice, saveToDevice } from "@/lib/client-download";
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

export type TaskStatus = "queued" | "preparing" | "downloading" | "paused" | "completed" | "failed" | "canceled";

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

// ── Run concurrency gate ────────────────────────────────────────────────────
// A batch (e.g. every photo of a TikTok slideshow) used to fire ALL its
// downloads at once. That hammered the extractor with N simultaneous requests
// for the same post — the platform rate-limits, so most came back as failures
// ("batch always shows failed"). We now run at most MAX_CONCURRENT at a time and
// hold the rest as "queued"; the first request also warms the metadata cache so
// the siblings resolve instantly instead of each re-extracting.
const MAX_CONCURRENT = 2;
let activeRuns = 0;
const runQueue: string[] = [];

function pump() {
  while (activeRuns < MAX_CONCURRENT && runQueue.length > 0) {
    const id = runQueue.shift();
    if (id === undefined) break;
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === "canceled" || task.status === "completed") continue;
    activeRuns += 1;
    void run(id).finally(() => {
      activeRuns -= 1;
      pump();
    });
  }
}

function enqueueRun(id: string) {
  if (!runQueue.includes(id)) runQueue.push(id);
  pump();
}

function dequeueRun(id: string) {
  const i = runQueue.indexOf(id);
  if (i !== -1) runQueue.splice(i, 1);
}

// ── Serialized device-saves ─────────────────────────────────────────────────
// Browsers block multiple programmatic downloads fired in a tight loop — only
// the FIRST `<a download>` click lands, the rest are silently dropped ("only one
// file downloads"). Saving one at a time with a small gap lets every file in a
// batch actually reach the device.
const SAVE_GAP_MS = 700;
const saveQueue: (() => void)[] = [];
let savePumping = false;

function enqueueSave(fn: () => void) {
  saveQueue.push(fn);
  if (savePumping) return;
  savePumping = true;
  const next = () => {
    const job = saveQueue.shift();
    if (!job) {
      savePumping = false;
      return;
    }
    try {
      job();
    } catch {
      /* a single save failing must not stall the queue */
    }
    setTimeout(next, SAVE_GAP_MS);
  };
  next();
}

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
// (iOS — the share sheet requires a user gesture) can hand them over.
//
// Deliberately a SMALL cap: holding a batch of videos in memory on a phone is
// how Safari decides to kill the tab. It used to mean a batch lost its earliest
// files ("File expired"), but `finishedFile()` now falls back to the on-device
// library every completed download is written to — so the cap bounds memory
// without ever losing a file.
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
  // "preparing", not "downloading": the /api/download request BLOCKS while the
  // server extracts + transcodes the file, before a single byte streams back.
  // Showing "Preparing…" here (instead of a stuck 0% "Downloading") is the fix
  // for "it takes time showing downloading but isn't actually downloading yet".
  patch(id, { status: "preparing", error: null, receivedBytes: 0, speed: 0 });
  const startedAt = performance.now();
  trackDownload("started", { downloadId: task.id, platform: task.platform, mediaKind: task.kind, quality: task.qualityLabel });

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
    let flowing = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        // First byte in → the server finished preparing and is now streaming.
        if (!flowing) {
          flowing = true;
          patch(id, { status: "downloading" });
        }
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
    // Serialized (see enqueueSave): a batch's files save one-by-one with a gap
    // so the browser doesn't drop all but the first.
    if (!ios) enqueueSave(() => saveBlob(blob, filename));

    patch(id, { status: "completed", receivedBytes: received, totalBytes: total || received, speed: 0, awaitingSave: ios });
    completedCount += 1;
    for (const l of completionListeners) l();
    trackDownload("completed", {
      downloadId: task.id,
      platform: task.platform,
      mediaKind: task.kind,
      quality: task.qualityLabel,
      fileSize: received,
      durationMs: Math.round(performance.now() - startedAt),
    });
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
    const reason = err instanceof Error ? err.message : "Download failed";
    patch(id, { status: "failed", error: reason });
    trackDownload("failed", { downloadId: task.id, platform: task.platform, mediaKind: task.kind, quality: task.qualityLabel, errorReason: reason });
    toast("Download failed — tap retry", "error");
  } finally {
    controllers.delete(id);
    endCriticalActivity();
  }
}

/**
 * The finished file for a task, from memory or — if the in-memory copy was
 * evicted — from the on-device library it was persisted to when it completed.
 *
 * The fallback is what makes a BATCH work. `finishedBlobs` is deliberately small
 * (holding a dozen videos in memory on a phone invites Safari killing the tab),
 * so in a batch of eight the earliest files were always evicted and reported
 * "File expired — download it again" even though they were sitting in IndexedDB
 * the whole time. Every completed download is written to the library in `run()`,
 * so re-reading is exact, not a guess.
 */
async function finishedFile(id: string): Promise<{ blob: Blob; filename: string } | null> {
  const kept = finishedBlobs.get(id);
  if (kept) return kept;

  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  const blob = await getMedia(mediaKey(task.url, task.formatId, task.kind));
  if (!blob) return null;
  return { blob, filename: `${task.title || "download"}.${extFor(blob.type || "")}` };
}

/** Hand a finished task's file to the device (call from a TAP — iOS share sheet). */
export async function saveTaskToDevice(id: string): Promise<void> {
  // The in-memory copy is checked SYNCHRONOUSLY and shared with nothing awaited
  // in between. iOS only allows `navigator.share` while the tap's transient
  // activation is alive, and an IndexedDB read is a real task boundary — routing
  // the common case through the async fallback would risk breaking a save that
  // works today. The fallback below only runs when memory has already lost it,
  // where the alternative was failing outright.
  const kept = finishedBlobs.get(id);
  if (kept) {
    await saveToDevice(kept.blob, kept.filename);
    patch(id, { awaitingSave: false });
    return;
  }

  const file = await finishedFile(id);
  if (!file) {
    toast("File expired — download it again.", "error");
    return;
  }
  await saveToDevice(file.blob, file.filename);
  patch(id, { awaitingSave: false });
}

/** Every completed download still waiting to be handed to the device. */
export function tasksAwaitingSave(): DownloadTask[] {
  return tasks.filter((t) => t.status === "completed" && t.awaitingSave);
}

/**
 * Hand EVERY waiting file to the device in one gesture.
 *
 * The reason this exists: on iOS the share sheet needs a real user tap, so a
 * batch used to mean one tap per file — select all eight snaps of a story, then
 * tap Save eight times, dismissing eight sheets. The owner's "it only downloads
 * one, I have to mark them one after the other".
 *
 * `navigator.share` accepts an ARRAY of files, so the whole batch goes into a
 * single sheet and lands in Photos in one action. Must be called straight from
 * the tap: iOS revokes the gesture if an await runs first, so the files are
 * gathered BEFORE sharing and the share is the last thing that happens.
 */
export async function saveAllToDevice(): Promise<void> {
  const waiting = tasksAwaitingSave();
  if (waiting.length === 0) return;

  const files = (await Promise.all(waiting.map((t) => finishedFile(t.id).then((f) => (f ? { id: t.id, ...f } : null)))))
    .filter((f): f is { id: string; blob: Blob; filename: string } => f !== null);

  if (files.length === 0) {
    toast("Those files expired — download them again.", "error");
    return;
  }

  const saved = await saveFilesToDevice(files);
  // Only clear the flag for what actually went to the device: a partial save
  // must leave the rest still offering their button, not silently drop them.
  if (saved) for (const f of files) patch(f.id, { awaitingSave: false });
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
  // Analytics: the download was REQUESTED (one canonical row per download_id, so a
  // refresh/retry never double-counts). `started`/`completed`/`failed` follow in run().
  trackDownload("requested", { downloadId: id, platform: input.platform, mediaKind: input.kind, quality: input.qualityLabel });
  // No "started" toast — the floating progress card IS the notification.
  enqueueRun(id);
  return id;
}

export function pauseDownload(id: string) {
  dequeueRun(id);
  controllers.get(id)?.abort();
  controllers.delete(id);
  patch(id, { status: "paused", speed: 0 });
}
export function resumeDownload(id: string) {
  enqueueRun(id);
}
export function retryDownload(id: string) {
  enqueueRun(id);
}
export function cancelDownload(id: string) {
  dequeueRun(id);
  controllers.get(id)?.abort();
  controllers.delete(id);
  finishedBlobs.delete(id);
  tasks = tasks.filter((t) => t.id !== id);
  emit();
}
export function pauseAll() {
  for (const t of tasks) if (t.status === "downloading" || t.status === "preparing" || t.status === "queued") pauseDownload(t.id);
}
export function clearFinished() {
  for (const t of tasks) {
    if (t.status === "completed" || t.status === "failed" || t.status === "canceled") finishedBlobs.delete(t.id);
  }
  tasks = tasks.filter(
    (t) => t.status === "downloading" || t.status === "preparing" || t.status === "paused" || t.status === "queued",
  );
  emit();
}
