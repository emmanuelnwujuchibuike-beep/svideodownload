"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cancelAiJob } from "@/lib/ai/client";
import { getCharacterReplaceBatch, type CharacterReplaceBatchSummary } from "@/lib/ai/character-replace/client";
import { nextPollDelayMs } from "@/lib/ai/job-stages";
import type { AiJobView } from "@/lib/ai/jobs";

/**
 * Watch one multi-video session (0166) — every job of the batch from ONE
 * poll, backed off the platform's way, stopped when nothing in it can
 * change any more, resumed on visibility and on reconnect.
 *
 * The server is the only source of truth (brief §14): the hook holds
 * nothing a refresh could lose. A cancel goes through the same job route a
 * single video uses, and the next poll shows what the server did.
 */
export function useBatchWatch(batchId: string | null) {
  const [batch, setBatch] = useState<CharacterReplaceBatchSummary | null>(null);
  const [jobs, setJobs] = useState<AiJobView[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const attempts = useRef(0);
  const alive = useRef(true);
  const active = useRef(false);

  const stop = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!batchId || !alive.current) return;
    const res = await getCharacterReplaceBatch(batchId);
    if (!alive.current) return;
    if (res.ok) {
      setBatch(res.batch);
      setJobs(res.jobs);
      setMissing(false);
      setError(null);
      active.current = res.batch.active;
      if (!res.batch.active) {
        stop();
        return;
      }
    } else if (res.code === "JOB_NOT_FOUND") {
      setMissing(true);
      stop();
      return;
    } else {
      // A failed poll is not a failed batch: the schedule continues, the last picture stays.
      setError(res.error);
    }
    attempts.current += 1;
    if (typeof document !== "undefined" && document.hidden) return;
    timer.current = window.setTimeout(() => void poll(), nextPollDelayMs(attempts.current));
  }, [batchId, stop]);

  useEffect(() => {
    alive.current = true;
    attempts.current = 0;
    active.current = false;
    setBatch(null);
    setJobs([]);
    setMissing(false);
    setError(null);
    if (batchId) void poll();
    const onVisible = () => {
      if (document.hidden) {
        stop();
        return;
      }
      if (active.current) {
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
  }, [batchId, poll, stop]);

  /** Ask for a fresh picture now (after a cancel, a retry, a start). */
  const refresh = useCallback(() => {
    attempts.current = 0;
    stop();
    void poll();
  }, [poll, stop]);

  const cancel = useCallback(
    async (jobId: string) => {
      const res = await cancelAiJob(jobId);
      if (!alive.current) return res.ok;
      if (res.ok) setJobs((list) => list.map((j) => (j.id === jobId ? res.job : j)));
      refresh();
      return res.ok;
    },
    [refresh],
  );

  return { batch, jobs, missing, error, cancel, refresh };
}
