"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ProcessingJob } from "@/lib/ai/character-replace/types";
import { processingStatusFor } from "@/lib/ai/character-replace/types";
import { cancelAiJob, getAiJob, getAiJobResult } from "@/lib/ai/client";
import { nextPollDelayMs } from "@/lib/ai/job-stages";
import { isActiveStatus, type AiJobView } from "@/lib/ai/jobs";

/**
 * Watch one platform job and present it as a `ProcessingJob`.
 *
 * This is the seam the real job system plugs into (§13): Part 2's start flow
 * produces a job id; this hook turns the row behind it into the state the
 * processing and result screens draw. It also serves the push notification's
 * own link today — `?job=<id>` on the workspace — so a member sent here to
 * look at a finished job sees it.
 *
 * ── Polling, the platform's way ─────────────────────────────────────────────
 *
 * `isActiveStatus` from the registry decides whether to keep asking — never a
 * hand-written list — and `nextPollDelayMs` backs off the way every other AI
 * surface does. A hidden tab stops; visibility resumes immediately. A failed
 * poll is not a failed job: the schedule simply continues.
 *
 * ── 🔴 NO CREEPING PROGRESS ─────────────────────────────────────────────────
 *
 * `progress` is null for every server-side phase. The processing screen draws
 * an indeterminate stripe for null, which is the honest picture of a job whose
 * progress the server does not report. The measured upload phase is the
 * browser's, and Part 2's start flow will set it from the XHR.
 */
export function useJobWatch(jobId: string | null) {
  const [job, setJob] = useState<AiJobView | null>(null);
  const [missing, setMissing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const attempts = useRef(0);
  const alive = useRef(true);
  const current = useRef<AiJobView | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!jobId || !alive.current) return;
    const res = await getAiJob(jobId);
    if (!alive.current) return;
    if (res.ok) {
      current.current = res.job;
      setJob(res.job);
      setMissing(false);
      if (!isActiveStatus(res.job.status)) {
        stop();
        return;
      }
    } else if (res.code === "JOB_NOT_FOUND") {
      setMissing(true);
      stop();
      return;
    }
    attempts.current += 1;
    if (typeof document !== "undefined" && document.hidden) return;
    timer.current = window.setTimeout(() => void poll(), nextPollDelayMs(attempts.current));
  }, [jobId, stop]);

  useEffect(() => {
    alive.current = true;
    attempts.current = 0;
    setJob(null);
    setMissing(false);
    setPreviewUrl(null);
    if (jobId) void poll();
    const onVisible = () => {
      if (document.hidden) {
        stop();
        return;
      }
      if (current.current && isActiveStatus(current.current.status)) {
        attempts.current = 0;
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      alive.current = false;
      stop();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [jobId, poll, stop]);

  // A finished job gets its signed preview URL — 10 minutes, ownership checked server-side.
  useEffect(() => {
    if (!job || job.status !== "completed") return;
    let cancelled = false;
    void (async () => {
      const res = await getAiJobResult(job.id);
      if (!cancelled && res.ok) setPreviewUrl(res.url);
    })();
    return () => {
      cancelled = true;
    };
  }, [job]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    const res = await cancelAiJob(jobId);
    if (alive.current && res.ok) {
      current.current = res.job;
      setJob(res.job);
    }
  }, [jobId]);

  const processing: ProcessingJob | null = job
    ? {
        status: processingStatusFor(job.status),
        job,
        progress: null,
        estimatedSecondsRemaining: null,
        // Safe while nothing has been handed to the provider: the row is still
        // `queued`, and cancelling it releases the funding. Once processing has
        // begun the provider has been paid for, and the platform's cancel refuses.
        canCancel: job.status === "queued",
        message: job.status === "failed" ? (job.error?.message ?? null) : null,
      }
    : null;

  return { job, processing, previewUrl, missing, cancel };
}
