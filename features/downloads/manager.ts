"use client";

import { trackDownload } from "@/lib/analytics/client";
import { isRetryable, MAX_ATTEMPTS, RETRY_DELAY_MS } from "@/features/downloads/retry-policy";
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
  /** How many times this task has been attempted, including the current one. */
  attempts?: number;
  /** True once preparing has run long enough to be worth explaining. */
  slowPrepare?: boolean;
  /**
   * Shared by every item of one batch — a story's snaps, a slideshow's photos.
   *
   * The server charges the daily cap ONCE per batch id (owner, 2026-08-09:
   * "multiple download should be recorded as one in the free user daily limit
   * for download but not the rest api request"). Absent for a single download,
   * which is charged on its own id.
   */
  batchId?: string;
  /**
   * Which SOURCE LINK inside the batch this task came from.
   *
   * The admin outcome alert groups on it so one broken link sends ONE email and
   * ONE push instead of one per media item (owner, 2026-08-26). A multi-link
   * batch passes the per-source id, so ten links still report ten times; a
   * single link that expanded into several media leaves it unset and falls back
   * to `batchId`, which already means "this one link".
   */
  linkKey?: string;
  /** Clip length in seconds when the extractor reported one — shown in history. */
  durationSeconds?: number | null;
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

/**
 * Automatic retry (owner, 2026-08-09: "make failed downloads automatically
 * retry... let there be zero fail rate").
 *
 * The policy itself lives in ./retry-policy — a plain module with no browser
 * APIs, so it can actually be unit-tested. It was inline here, inside a
 * "use client" file, which is exactly how it shipped with a regex full of
 * literal control bytes and a rule that retried HTTP 429 until the daily
 * download cap ran away. See that file and its test.
 */
/**
 * How long a prepare may run before the card explains itself and offers a way
 * to spend the wait.
 *
 * FIVE seconds, set by the owner (2026-08-09: "the prompt should only show when
 * the prepare download takes more than 5 secs"). It was six.
 */
const SLOW_PREPARE_MS = 5_000;

let activeRuns = 0;
const runQueue: string[] = [];

/**
 * Source URLs currently being extracted.
 *
 * A batch is N items from ONE post, so all N hit the same extraction. Running
 * two of them at once means two simultaneous requests for the same page, which
 * the platform rate-limits — and the loser comes back 502. That is the owner's
 * "in batch download, one file always fails until I retry": not a random
 * failure, a self-inflicted one.
 *
 * Serialising per URL costs nothing, because the FIRST request warms the
 * metadata cache and every sibling then resolves from it instantly. Different
 * URLs still run in parallel up to MAX_CONCURRENT.
 */
const activeSources = new Set<string>();

function pump() {
  let scanned = 0;
  while (activeRuns < MAX_CONCURRENT && scanned < runQueue.length) {
    const id = runQueue[scanned]!;
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === "canceled" || task.status === "completed") {
      runQueue.splice(scanned, 1);
      continue;
    }
    // Another item from the same post is mid-flight — leave this one queued
    // and look at the next, rather than blocking the whole queue behind it.
    if (activeSources.has(task.url)) {
      scanned += 1;
      continue;
    }
    runQueue.splice(scanned, 1);
    activeRuns += 1;
    activeSources.add(task.url);
    void run(id).finally(() => {
      activeRuns -= 1;
      activeSources.delete(task.url);
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
export interface DownloadCompletion {
  id: string;
  /** Set when this completion was one item of a batch (see `batchId` on
   *  `DownloadTask`) — the rating prompt treats a batch completion as a
   *  bigger vote of confidence than a single file finishing. */
  batchId?: string;
  /** Today's persisted single (non-batch) download count AFTER this
   *  completion, or null for a batch item. See `getDailySingleDownloadCount`. */
  dailySingleCount: number | null;
}
const completionListeners = new Set<(info: DownloadCompletion) => void>();

/**
 * How many single (non-batch) downloads THIS DEVICE has completed today —
 * the rating prompt's "twice today" trigger (owner, 2026-08-16: "Download
 * should be recorded on the device so when same device make a single
 * Download twice that day the rating promt should show up it doesn't have
 * to be consecutive").
 *
 * Recorded HERE, at the moment a download actually finishes, rather than by
 * the rating-prompt component reacting to a completion event — that
 * component's chunk is dynamically imported and only mounts after the
 * FIRST completion `floating-progress.tsx` has already seen this session,
 * so it cannot be the thing persisting a count that has to include
 * completions from BEFORE it mounted (including ones from an earlier
 * session, hours or days apart — "it doesn't have to be consecutive").
 * Owning the write here means the count is correct regardless of what UI
 * happens to be mounted when a transfer finishes.
 */
const RATING_DAILY_KEY = "frenz:rating-prompt-daily";
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
function bumpDailySingleCount(): number {
  try {
    const raw = localStorage.getItem(RATING_DAILY_KEY);
    const parsed = raw ? (JSON.parse(raw) as { date?: string; count?: number }) : null;
    const count = parsed?.date === todayUtc() && typeof parsed.count === "number" ? parsed.count + 1 : 1;
    localStorage.setItem(RATING_DAILY_KEY, JSON.stringify({ date: todayUtc(), count }));
    return count;
  } catch {
    return 0;
  }
}
/** Peeks today's persisted single-download count WITHOUT incrementing it —
 *  for a fresh mount to catch up on completions it wasn't there to observe. */
export function getDailySingleDownloadCount(): number {
  try {
    const raw = localStorage.getItem(RATING_DAILY_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { date?: string; count?: number };
    return parsed.date === todayUtc() && typeof parsed.count === "number" ? parsed.count : 0;
  } catch {
    return 0;
  }
}

/** Total downloads completed this session (never decremented). */
export function getCompletedCount(): number {
  return completedCount;
}
/** Subscribe to download completions (fires once per finished transfer). */
export function onDownloadCompleted(cb: (info: DownloadCompletion) => void): () => void {
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

/**
 * Notify subscribers at most ONCE PER FRAME (owner, 2026-08-10: the landing
 * page "becomes worse and overheats when I fetch multiple downloads media").
 *
 * ── What this was doing ──────────────────────────────────────────────────────
 * Every `patch()` reassigned `tasks` to a new array and called every listener
 * synchronously. Each subscriber reads that array through
 * `useSyncExternalStore`, so a new identity means every one of them re-renders,
 * and there are a lot of them: the floating progress card, the hero result
 * panel, the download box, the history gallery, the topbar slot.
 *
 * A single download patches on a 400ms throttle, which is fine. A BATCH does
 * not: two concurrent transfers each patch on their own timer, and every status
 * transition, retry, save-queue step and completion patches too — all
 * unbatched, all landing at arbitrary points inside a frame. React cannot
 * coalesce them because they arrive from outside its event system, so each one
 * is a separate render-and-commit, several times a second, for the whole
 * lifetime of a batch. On a phone, with the landing's gradients and the
 * progress card's `backdrop-blur` recompositing behind each commit, that is
 * sustained GPU and main-thread work — which is what heat is.
 *
 * ── Why a frame, and why the snapshot still updates immediately ──────────────
 * Coalescing to `requestAnimationFrame` means at most one notification per
 * painted frame, which is the most a human can perceive anyway. The array
 * itself is replaced eagerly, so `getSnapshot()` is always current — anything
 * reading synchronously (a click handler deciding whether a download is already
 * running) sees the truth, it is only the RE-RENDER that waits.
 *
 * Completion is deliberately NOT deferred: `flush()` is called directly at the
 * points where a person is waiting for an answer, so "Saved" never lags a
 * frame behind the bytes.
 */
let frame: number | null = null;

function flush() {
  if (frame !== null) {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    frame = null;
  }
  for (const l of listeners) l();
}

function emit(immediate = false) {
  // Eager, so a synchronous read after a patch is never stale.
  tasks = [...tasks];
  if (immediate || typeof requestAnimationFrame !== "function") {
    flush();
    return;
  }
  if (frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    for (const l of listeners) l();
  });
}
function patch(id: string, next: Partial<DownloadTask>) {
  const i = tasks.findIndex((t) => t.id === id);
  if (i === -1) return;
  tasks[i] = { ...tasks[i]!, ...next };
  /*
    A TERMINAL status paints now; progress waits for the frame.

    The batching above exists to stop mid-transfer noise re-rendering the app
    several times a second. It must not delay the moment a person is actually
    waiting for — "Saved", "Failed", the file being ready — so the states
    someone is watching for skip the queue. There are only three of them, and
    each happens once per download.
  */
  const terminal = next.status === "completed" || next.status === "failed" || next.status === "canceled";
  emit(terminal);
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

function buildUrl(t: Pick<DownloadTask, "url" | "formatId" | "kind" | "title" | "id" | "batchId">): string {
  const sp = new URLSearchParams({ url: t.url, formatId: t.formatId, kind: t.kind, title: t.title });
  /*
    `b` — the BATCH this download belongs to, when it belongs to one.

    A story or a slideshow is N items from ONE post, and the member asked for
    one thing. Charging the daily cap per item meant a 12-photo TikTok
    slideshow spent 12 of a free visitor's 30 — and the twelfth request came
    back 429 while the first eleven succeeded, which is the "some failed with
    429" being reported.

    The server keys its receipt on this, so the whole batch costs ONE unit
    however many files it contains. It deliberately does NOT reduce the number
    of API requests — each file still needs its own extraction and transfer;
    it is only the member-facing QUOTA that treats the batch as one download.
  */
  if (t.batchId) sp.set("b", t.batchId);
  /*
    `t` — this download's identity, stable across automatic retries.

    The server spends one unit of the daily cap per REQUEST, and auto-retry can
    make three of them for one download. Sending the task id lets the server
    charge the download once and let its retries through on the same receipt.
    Without it a free visitor's 30/day silently became 10, and the resulting
    429s were themselves retried — which is how every download on the site ended
    up failing (owner, 2026-08-09).
  */
  sp.set("t", t.id);
  return `/api/download?${sp.toString()}`;
}

/**
 * Where this task's bytes actually come from.
 *
 * 🔴 A RELATIVE `url` IS ALREADY THE TARGET, NEVER PIPELINE INPUT.
 * Wallpapers download from `/api/wallpaper?id=…`, a same-origin path. Handing
 * that to /api/download is wrong twice over: `new URL()` throws on a relative
 * path so `sourceUrlSchema` rejects it outright ("That doesn't look like a
 * valid URL" — the admin alert the owner saw, 2026-08-24), and even if it
 * validated, the pipeline would try to run yt-dlp on our own image endpoint.
 *
 * `directUrl` covers this for anything downloaded from now on. This check is
 * for the records that already exist: history is the visitor's own
 * localStorage, so every wallpaper saved before `directUrl` was persisted has
 * none, and every retry of one would fail forever without a backstop that
 * needs no stored field.
 */
function fetchTarget(t: DownloadTask): string {
  if (t.directUrl) return t.directUrl;
  // Same-origin path (starts with a single slash, not the "//host" form).
  if (/^\/(?!\/)/.test(t.url)) return t.url;
  return buildUrl(t);
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

/**
 * The message to show for a failed request — the SERVER's, when it wrote one.
 *
 * ── Why this exists (owner, 2026-08-09) ──────────────────────────────────────
 * "when there is a free limit reach it should show and not just an error."
 *
 * This used to throw `HTTP ${res.status}`, so the card said "Download failed —
 * HTTP 429" and nothing else. Meanwhile `/api/download` was already answering
 * with exactly the right sentence — "Daily download limit reached (30/day).
 * Sign up or upgrade for more." — and the client threw it away without reading
 * the body. The explanation existed the whole time; nobody was shown it.
 *
 * Falls back to the status only when there is genuinely nothing better: a
 * response with no JSON body, or one whose body does not name a reason.
 */
async function failureMessage(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim().length > 0) return body.error;
  } catch {
    /* not JSON — fall through to the status */
  }
  // 429 is the one status worth naming in plain words even without a body: it
  // is a limit, not a fault, and "HTTP 429" reads like something broke.
  if (res.status === 429) return "Daily download limit reached. Try again tomorrow or upgrade.";
  return `HTTP ${res.status}`;
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
  patch(id, {
    status: "preparing",
    error: null,
    receivedBytes: 0,
    speed: 0,
    slowPrepare: false,
    attempts: task.attempts ?? 1,
  });

  /*
    A long prepare is EXPLAINED, not left silent (owner: "when a preparing
    download takes longer they should be informed that this is taking longer
    due to large file, please wait").

    The server blocks while it extracts and, for a large file, muxes video and
    audio — that is genuinely slow and nothing is wrong. A progress card stuck
    on "Preparing…" with no explanation reads as a hang, and people cancel
    perfectly good downloads because of it.
  */
  const slowTimer = setTimeout(() => {
    const current = tasks.find((t) => t.id === id);
    if (current?.status === "preparing") patch(id, { slowPrepare: true });
  }, SLOW_PREPARE_MS);
  const startedAt = performance.now();
  trackDownload("started", { downloadId: task.id, platform: task.platform, mediaKind: task.kind, quality: task.qualityLabel });

  // Held for the actual byte transfer — a service-worker-driven reload mid-
  // download would silently drop it with no way to resume (the stream isn't
  // range-resumable). Released in `finally` below, same lifecycle as the
  // AbortController: pause/cancel/complete/fail all end this `run()` call.
  const endCriticalActivity = beginCriticalActivity();

  try {
    const res = await fetch(fetchTarget(task), { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(await failureMessage(res));

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
    const dailySingleCount = task.batchId ? null : bumpDailySingleCount();
    for (const l of completionListeners) l({ id, batchId: task.batchId, dailySingleCount });
    trackDownload("completed", {
      downloadId: task.id,
      platform: task.platform,
      mediaKind: task.kind,
      quality: task.qualityLabel,
      fileSize: received,
      durationMs: Math.round(performance.now() - startedAt),
      // >1 means this download failed or was cancelled at least once first —
      // the server turns that into the admin "succeeded in N tries" push.
      attempts: task.attempts ?? 1,
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
      durationSeconds: task.durationSeconds ?? null,
      directUrl: task.directUrl ?? null,
    });
    if (!ios) toast("Download complete — saved to your device & library", "success");
  } catch (err) {
    if (controller.signal.aborted) return; // paused/canceled handled elsewhere
    const reason = err instanceof Error ? err.message : "Download failed";
    const attempt = (tasks.find((t) => t.id === id)?.attempts ?? 1);

    /*
      Retry transient failures automatically before telling anybody.

      The owner's error log is almost entirely HTTP 502 — an upstream hiccup
      that succeeds on a second try. Surfacing that as "Download failed — tap
      retry" makes our flakiness the member's job. It is only reported once the
      attempts are genuinely spent, or when the cause is settled (a 404 says
      the same thing however many times it is asked).
    */
    if (attempt < MAX_ATTEMPTS && isRetryable(reason)) {
      const delay = RETRY_DELAY_MS[attempt - 1] ?? 2500;
      patch(id, { status: "queued", error: null, speed: 0, receivedBytes: 0, attempts: attempt + 1 });
      setTimeout(() => {
        // Still wanted? A pause or cancel in the meantime wins.
        const current = tasks.find((t) => t.id === id);
        if (current && current.status === "queued") enqueueRun(id);
      }, delay);
      return;
    }

    patch(id, { status: "failed", error: reason });
    trackDownload("failed", {
      downloadId: task.id,
      platform: task.platform,
      mediaKind: task.kind,
      quality: task.qualityLabel,
      errorReason: reason,
      // Grouping keys ride the TERMINAL event, which is the one the admin
      // alert fires from — see migration 0137.
      batchId: task.batchId,
      linkKey: task.linkKey ?? task.batchId,
    });

    /*
      Keep the FAILED attempt in history so it can be retried later (owner,
      2026-08-23: "add downloads failed and cancelled in history so users can
      retry at any day").

      Until now `addDownload` was only called on success, so a failure vanished
      the moment its card was dismissed and the link was gone with it — the
      person had to find the original post again. The record carries everything
      a retry needs (url, formatId, kind, quality), which is exactly what the
      history tile's Retry re-submits.

      `addDownload` de-duplicates on url+formatId+kind, so a later successful
      attempt at the same thing REPLACES this row rather than leaving a failure
      sitting next to its own success.
    */
    addDownload({
      url: task.url,
      platform: task.platform,
      platformName: task.platformName,
      title: task.title,
      thumbnail: task.thumbnail ?? null,
      formatId: task.formatId,
      kind: task.kind,
      qualityLabel: task.qualityLabel,
      status: "failed",
      failureReason: reason,
      directUrl: task.directUrl ?? null,
    });

    /*
      🔴 The daily cap gets its OWN toast, not the generic one (owner,
      2026-08-16: "notify users when they reach their daily batch downloads
      limit and give options to upgrade to pro for more batch downloads or
      continue single downloads").

      `reason` here is the SERVER's own sentence (`failureMessage` above reads
      `body.error` verbatim from `/api/download`'s 429 — see that route for
      the exact two variants). "Download failed — tap retry" is actively
      wrong for this case: retrying does nothing until the UTC-day reset, and
      a member reading it as a transient glitch has no idea WHY the button
      stopped working — which is indistinguishable, from the outside, from
      the batch-gate bug this same report described. Naming the real reason
      and offering the one action that helps (upgrade) is the fix for both
      readings of the complaint.

      The "Sign up or upgrade for more." phrasing is specifically the FREE-plan
      branch of that route — Pro/Business have a cap too (far higher), and
      offering them an upgrade they already bought would be wrong, so they get
      the same honest message with no action button.
    */
    if (reason.startsWith("Daily download limit reached")) {
      const isFree = reason.includes("Sign up or upgrade for more.");
      toast(reason, "error", {
        duration: 8000,
        action: isFree ? { label: "Go Pro", onClick: () => window.location.assign("/pricing") } : undefined,
      });
    } else {
      toast("Download failed — tap retry", "error");
    }
  } finally {
    clearTimeout(slowTimer);
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
  durationSeconds?: number | null;
  /** Shared across one batch so the daily cap is charged once. See DownloadTask. */
  batchId?: string;
  /** Which source link inside the batch — groups admin alerts. See DownloadTask. */
  linkKey?: string;
}): string {
  /*
    A double tap is ONE download (owner audit, 2026-08-09).

    Every call minted a fresh UUID, so two taps on the same button — the norm on
    a laggy phone when the first tap produces no instant feedback — started two
    identical transfers. That is two rows in `analytics_downloads`, two units off
    the daily cap, twice the extractor load for one file, and a success rate
    computed against a denominator the visitor never intended.

    Matching on the exact (url, formatId, kind) triple while a task for it is
    still in flight returns the ORIGINAL id, so the caller's UI still gets an id
    to follow and nothing downstream can tell the difference. A finished or
    failed task is not matched — re-downloading something you already have is a
    real second download.
  */
  const inFlight = tasks.find(
    (t) =>
      t.url === input.url &&
      t.formatId === input.formatId &&
      t.kind === input.kind &&
      (t.status === "queued" || t.status === "preparing" || t.status === "downloading"),
  );
  if (inFlight) return inFlight.id;

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
  // `sourceUrl`/`title` ride this first event only — the admin download log joins
  // them back from here (migration 0115).
  trackDownload("requested", {
    downloadId: id,
    platform: input.platform,
    mediaKind: input.kind,
    quality: input.qualityLabel,
    sourceUrl: input.url,
    title: input.title,
    batchId: input.batchId,
    linkKey: input.linkKey ?? input.batchId,
  });
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
  /*
    Report the cancellation before the task is dropped (owner audit,
    2026-08-09).

    This used to delete the task silently, so `download_cancelled` — a declared
    event type with a column in `analytics_downloads` and a card on the
    dashboard — was NEVER emitted by anything. "Downloads cancelled" was a
    permanent zero, and worse, the abandoned download stayed in the table as
    'requested' forever, which dragged the success-rate denominator down. A
    visitor changing their mind was being counted as a download we failed to
    deliver.
  */
  const task = tasks.find((t) => t.id === id);
  if (task && (task.status === "queued" || task.status === "preparing" || task.status === "downloading")) {
    trackDownload("cancelled", {
      downloadId: id,
      platform: task.platform,
      mediaKind: task.kind,
      quality: task.qualityLabel,
      batchId: task.batchId,
      linkKey: task.linkKey ?? task.batchId,
    });

    /* Cancelled attempts are kept in history too, for the same reason failures
       are: the link is the thing worth not losing, and "I stopped it, I'll grab
       it later" is the most ordinary reason of all to want it back. */
    addDownload({
      url: task.url,
      platform: task.platform,
      platformName: task.platformName,
      title: task.title,
      thumbnail: task.thumbnail ?? null,
      formatId: task.formatId,
      kind: task.kind,
      qualityLabel: task.qualityLabel,
      status: "cancelled",
      failureReason: null,
      directUrl: task.directUrl ?? null,
    });
  }
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
