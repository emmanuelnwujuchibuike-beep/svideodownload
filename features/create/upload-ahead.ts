"use client";

import { useSyncExternalStore } from "react";

import { captureVideoPoster } from "@/lib/media/video-poster";
import { presignUpload, uploadPostMedia, uploadWithPlanProgress } from "@/lib/storage/client-upload";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  UPLOAD-AHEAD — a video starts uploading the moment it is picked
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13: "Posting a video takes too long."
 *
 * ── Where the time went ────────────────────────────────────────────────────
 *
 * `publishComposition` began EVERYTHING on the Publish tap — the auth check,
 * decoding the file for a poster frame, a presign round-trip, one PUT of the
 * whole file, the poster's presign and PUT, then the API call — all in
 * series, all after a tap that typically came a caption and a destination
 * later than the file did. The bytes had been sitting on the phone the whole
 * time. This is the same shape as the 2026-07-10 "Publish to everyone" fix
 * (download-player.tsx), applied to the composer.
 *
 * ── What this does ─────────────────────────────────────────────────────────
 *
 * `useComposerMedia.accept` calls `startUploadAhead` for every VIDEO the
 * moment it is chosen. From then on, in parallel: the presign, the poster
 * capture, the poster's own upload, and the video PUT with live progress.
 * `publishComposition` then AWAITS the job instead of starting one — for the
 * common case (pick, type a caption, tap) the video is already up and Publish
 * costs one API call.
 *
 * Videos only. A photo can be re-edited after it is picked (`applyEdit`
 * replaces the file), so an early upload of it could be the wrong bytes; a
 * photo also uploads in a second or two, which was never the complaint.
 *
 * ── Failure is never fatal ─────────────────────────────────────────────────
 *
 * A job that fails — network drop, an expired presign, a removed item — is
 * simply absent at publish time, and `publishComposition` uploads the item
 * the old way. Removing an item aborts its transfer; leaving the surface
 * aborts them all (the composer hook's unmount cleanup).
 */

export interface UploadAheadResult {
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface UploadAheadJob {
  /** 0..1 of the VIDEO's bytes sent. Poster work is not counted. */
  progress: number;
  status: "uploading" | "done" | "failed";
  result: Promise<UploadAheadResult>;
  abort: () => void;
}

const jobs = new Map<string, UploadAheadJob>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function extOf(file: File): string {
  return (file.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
}

export function startUploadAhead(id: string, file: File): void {
  if (jobs.has(id)) return;
  const controller = new AbortController();
  const job: UploadAheadJob = {
    progress: 0,
    status: "uploading",
    abort: () => controller.abort(),
    result: Promise.resolve() as unknown as Promise<UploadAheadResult>,
  };
  job.result = (async () => {
    const contentType = file.type || "video/mp4";
    // The presign and the poster capture do not depend on each other.
    const [plan, captured] = await Promise.all([
      presignUpload("video", extOf(file)),
      captureVideoPoster(file).catch(() => ({ blob: null as Blob | null, width: null as number | null, height: null as number | null })),
    ]);
    if (controller.signal.aborted) throw new Error("Upload cancelled.");
    // The poster's upload runs BESIDE the video's, not after it.
    const poster: Promise<string | null> = captured.blob
      ? uploadPostMedia({ data: captured.blob, kind: "image", ext: "jpg", contentType: "image/jpeg" }).catch(() => null)
      : Promise.resolve(null);
    const url = await uploadWithPlanProgress(plan, file, contentType, {
      signal: controller.signal,
      onProgress: (fraction) => {
        job.progress = fraction;
        emit();
      },
    });
    const thumbnailUrl = await poster;
    return { url, thumbnailUrl, width: captured.width, height: captured.height };
  })();
  job.result.then(
    () => {
      job.status = "done";
      job.progress = 1;
      emit();
    },
    () => {
      job.status = "failed";
      emit();
    },
  );
  jobs.set(id, job);
  emit();
}

/** The job for an item, if one was started and has not been cancelled. */
export function getUploadAhead(id: string): UploadAheadJob | undefined {
  return jobs.get(id);
}

/** Abort and forget an item's job (a removed item, a reset surface). */
export function cancelUploadAhead(id: string): void {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  job.abort();
  emit();
}

/** Forget a finished job once its result has been consumed by a publish. */
export function releaseUploadAhead(id: string): void {
  if (jobs.delete(id)) emit();
}

/**
 * Live progress for a media tile. `null` when there is no job — a photo, or
 * a video whose early upload failed and will be uploaded at publish time.
 */
export function useUploadAheadProgress(id: string | null | undefined): { progress: number; status: UploadAheadJob["status"] } | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (id ? snapshotFor(id) : null),
    () => null,
  );
}

// `useSyncExternalStore` needs a STABLE snapshot for an unchanged state, so
// each job's last-served snapshot is cached and only replaced on change.
const snapshots = new WeakMap<UploadAheadJob, { progress: number; status: UploadAheadJob["status"] }>();
function snapshotFor(id: string) {
  const job = jobs.get(id);
  if (!job) return null;
  const prev = snapshots.get(job);
  if (prev && prev.progress === job.progress && prev.status === job.status) return prev;
  const next = { progress: job.progress, status: job.status };
  snapshots.set(job, next);
  return next;
}
