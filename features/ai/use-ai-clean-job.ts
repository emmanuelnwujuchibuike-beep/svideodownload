"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  cancelAiJob,
  createAiJob,
  getAiCleanEntitlement,
  getAiJob,
  grantAiReward,
  openAiRewardSession,
  getAiJobResult,
  getAiJobSource,
  listAiJobs,
  newClientRequestId,
  startAiJob,
  uploadSource,
  type AiCleanEntitlement,
  type AiJobUsage,
} from "@/lib/ai/client";
import { nextPollDelayMs, stageFor, type StageView } from "@/lib/ai/job-stages";
import { isActiveStatus, type AiJobView } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI CLEAN — the one state machine
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07 (Part 3): "Do not create separate duplicated state machines
 * in multiple components."
 *
 * Everything a running job involves lives here: creating it, uploading to the
 * signed target, starting it, watching it, cancelling it, retrying it, and
 * finding it again after the page went away. Components render what this
 * returns and call what it exposes; none of them own a piece of the flow.
 *
 * ── 🔴 A JOB SURVIVES THE PAGE ───────────────────────────────────────────────
 *
 * The work happens on a provider's machines, not in this tab, so a refresh, a
 * closed PWA, a locked phone or a dropped connection must not lose it. On
 * mount, before anything else, this asks the server for jobs that are still
 * running and adopts one. That single request is why "your video is still being
 * processed" is a fact we look up rather than a guess from local state — and it
 * is why nothing about a job is kept in localStorage, where it could contradict
 * the server.
 *
 * ── Polling, and its manners ────────────────────────────────────────────────
 *
 * One timer, backing off (lib/ai/job-stages.ts), stopped the moment a job is
 * terminal, and PAUSED while the tab is hidden — a phone in a pocket polling a
 * ten-minute job is the battery rule this project holds every surface to.
 * Coming back into view checks immediately, so a member returning to the tab
 * never waits out a long interval to see that their video is ready.
 */

export interface AiCleanJobState {
  job: AiJobView | null;
  view: StageView;
  usage: AiJobUsage | null;
  /** A refusal worth showing, already written as a sentence. */
  error: { code: string; message: string } | null;
  /** True until the first "is anything already running?" answer arrives. */
  restoring: boolean;
  /** True while a submission is in flight, so the button can be disabled. */
  busy: boolean;
  /**
   * What the server says this member may do. Null until the first answer.
   *
   * 🔴 For RENDERING only. The interface reads it to say "1 of 3 left today" and
   * to decide whether to open an ad — never to decide whether a job may run.
   * That decision is re-made server-side on every start, because this object
   * lives in a browser the member controls.
   */
  entitlement: AiCleanEntitlement | null;
  /**
   * Set while a real rewarded ad must be watched before the job can start.
   *
   * The workspace renders the app's existing `RewardedAdGate` on this — the
   * same component the downloader uses. Nothing here simulates an ad or grants
   * a reward on a timer.
   */
  pendingReward: { sessionId: string; step: number; total: number } | null;
}

export interface AiCleanJobActions {
  /** Create, upload, start. The whole submission, from one file. */
  submit: (file: File) => Promise<void>;
  /** Stop a running job and give the slot back. */
  cancel: () => Promise<void>;
  /** Clear the finished/failed job so the member can choose another video. */
  reset: () => void;
  /** A short-lived link to the finished video, fetched when it is needed. */
  /** `forDownload` asks for a link that SAVES rather than plays — see client.ts. */
  fetchResultUrl: (forDownload?: boolean) => Promise<string | null>;
  /** The same for the ORIGINAL, so the result can be compared against it. */
  fetchSourceUrl: () => Promise<string | null>;
  /** The ad finished: attest it, then start the job it was earned for. */
  completeReward: () => Promise<void>;
  /** The ad was closed early. Nothing is charged and nothing starts. */
  cancelReward: () => void;
  /** Re-read the allowance — after a job finishes, or on returning to the tab. */
  refreshEntitlement: () => Promise<void>;
}

export function useAiCleanJob(): AiCleanJobState & AiCleanJobActions {
  const [job, setJob] = useState<AiJobView | null>(null);
  const [usage, setUsage] = useState<AiJobUsage | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadFraction, setUploadFraction] = useState(0);
  const [restoring, setRestoring] = useState(true);
  const [busy, setBusy] = useState(false);
  const [entitlement, setEntitlement] = useState<AiCleanEntitlement | null>(null);
  const [pendingReward, setPendingReward] = useState<{ sessionId: string; step: number; total: number } | null>(
    null,
  );
  /** The job waiting on that ad. Held in a ref so the gate can stay dumb. */
  const awaitingRewardJobId = useRef<string | null>(null);

  /*
    Refs, not state, for everything the effects need to READ without being
    restarted by. A poll timer that re-created itself whenever the job object
    changed identity would reset its own backoff on every tick.
  */
  const jobRef = useRef<AiJobView | null>(null);
  const pollTimer = useRef<number | null>(null);
  const attempts = useRef(0);
  const alive = useRef(true);
  const uploadAbort = useRef<AbortController | null>(null);

  const applyJob = useCallback((next: AiJobView | null) => {
    jobRef.current = next;
    setJob(next);
  }, []);

  /* ── polling ──────────────────────────────────────────────────────────── */

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    const current = jobRef.current;
    if (!current || !alive.current) return;

    const res = await getAiJob(current.id);
    if (!alive.current) return;

    if (res.ok) {
      applyJob(res.job);
      // A job that stopped changing needs no more asking.
      //
      // 🔴 `isActiveStatus`, never a hand-written list. This was three separate
      // copies of "queued or processing", all written before `finalizing`
      // existed — and every one of them would have stopped polling the instant
      // the audio mux began, leaving somebody watching "removing text" on a job
      // that had already finished. The registry knows; this must ask it.
      if (!isActiveStatus(res.job.status)) {
        stopPolling();
        return;
      }
    }
    // A failed poll is NOT a failed job — a phone in a lift loses one request,
    // not its video. The schedule simply continues.

    attempts.current += 1;
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyJob, stopPolling]);

  const schedule = useCallback(() => {
    stopPolling();
    if (typeof document !== "undefined" && document.hidden) return; // resumed on visibility
    pollTimer.current = window.setTimeout(() => void poll(), nextPollDelayMs(attempts.current));
  }, [poll, stopPolling]);

  // Watch whatever job is current, and stop when there is nothing to watch.
  useEffect(() => {
    if (job && isActiveStatus(job.status)) {
      schedule();
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [job, schedule, stopPolling]);

  // Hidden tab: stop asking. Visible again: ask straight away.
  useEffect(() => {
    const onVisible = () => {
      const current = jobRef.current;
      if (document.hidden) {
        stopPolling();
        return;
      }
      if (current && isActiveStatus(current.status)) {
        attempts.current = 0;
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [poll, stopPolling]);

  const refreshEntitlement = useCallback(async () => {
    const res = await getAiCleanEntitlement();
    if (alive.current && res.ok) {
      const { ok: _ok, ...view } = res;
      setEntitlement(view as AiCleanEntitlement);
    }
  }, []);

  /* ── restore ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    alive.current = true;
    (async () => {
      // Both in parallel: what is running, and what this member may do.
      const [jobs] = await Promise.all([
        listAiJobs({ feature: "ai_clean", limit: 1, active: true }),
        refreshEntitlement(),
      ]);
      if (!alive.current) return;
      if (jobs.ok && jobs.jobs.length > 0) applyJob(jobs.jobs[0]!);
      setRestoring(false);
    })();

    return () => {
      alive.current = false;
      uploadAbort.current?.abort();
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    };
  }, [applyJob, refreshEntitlement]);

  /* ── the submission ───────────────────────────────────────────────────── */

  const submit = useCallback(
    async (file: File) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setUploadFraction(0);

      try {
        /*
          One key for one intent. It is created here and used for exactly this
          submission, so a retried request returns the job it already made
          instead of a second one. A "try again" after a failure is a NEW
          intent and gets a new key — the failed job is terminal and its slot
          has already gone back.
        */
        const clientRequestId = newClientRequestId();

        const created = await createAiJob({
          feature: "ai_clean",
          clientRequestId,
          source: {
            size: file.size,
            mimeType: file.type || "video/mp4",
            name: file.name,
          },
        });
        if (!alive.current) return;

        if (!created.ok) {
          setError({ code: created.code, message: created.error });
          if (created.usage) setUsage(created.usage);
          return;
        }

        applyJob(created.job);
        if (created.usage) setUsage(created.usage);

        if (!created.upload) {
          // The job exists but there is nowhere to put the file — it is already
          // past the point an upload belongs. Nothing to do but show its state.
          return;
        }

        setUploading(true);
        uploadAbort.current = new AbortController();
        const sent = await uploadSource({
          ticket: created.upload,
          file,
          onProgress: (fraction) => {
            if (alive.current) setUploadFraction(fraction);
          },
          signal: uploadAbort.current.signal,
        });
        if (!alive.current) return;
        setUploading(false);

        if (!sent) {
          setError({
            code: "UPLOAD_FAILED",
            message: "The upload didn't finish. Check your connection and try again.",
          });
          return;
        }

        /*
          🔴 THE AD GOES HERE — between the upload and the start.

          Not before the upload: making somebody watch an ad and THEN discover
          their file is too large is the wrong order. Not after the start: by
          then the job is already running and the ad has bought nothing.

          `rewardRequired` is the server's answer from the entitlement read. If
          the browser were wrong about it, the start below would refuse with
          REWARD_REQUIRED — the flow is a courtesy, the gate is the server.
        */
        if (entitlement?.rewardRequired) {
          const session = await openAiRewardSession();
          if (!alive.current) return;
          if (!session.ok) {
            setError({ code: session.code, message: session.error });
            return;
          }
          awaitingRewardJobId.current = created.job.id;
          setPendingReward({
            sessionId: session.sessionId,
            step: 1,
            // One today. Part 10 raises this for the paid plans and the gate
            // already renders "1 of 3" from these two numbers.
            total: Math.max(1, entitlement.rewardsPerJob || 1),
          });
          return; // completeReward() picks it up from here.
        }

        const started = await startAiJob(created.job.id);
        if (!alive.current) return;

        if (!started.ok) {
          setError({ code: started.code, message: started.error });
          if (started.usage) setUsage(started.usage);
          // The job's own state is still worth reading: the server may have
          // marked it failed, and the member should see that rather than a
          // stale "queued".
          const refreshed = await getAiJob(created.job.id);
          if (refreshed.ok && alive.current) applyJob(refreshed.job);
          return;
        }

        applyJob(started.job);
        if (started.usage) setUsage(started.usage);
        attempts.current = 0;
      } finally {
        if (alive.current) {
          setUploading(false);
          setBusy(false);
        }
      }
    },
    [applyJob, busy, entitlement],
  );

  /**
   * The ad finished. Attest it, then start the job it was earned for.
   *
   * A failure at either step leaves the job `queued` and unstarted — nothing is
   * charged, and the member can try again. That is the brief's rule about a
   * skipped or failed ad, and it falls out of the ordering rather than needing
   * to be handled: the allowance is only ever spent inside `start`.
   */
  const completeReward = useCallback(async () => {
    const pending = pendingReward;
    const jobId = awaitingRewardJobId.current;
    if (!pending || !jobId) return;

    setPendingReward(null);
    setBusy(true);
    try {
      const granted = await grantAiReward(pending.sessionId);
      if (!alive.current) return;
      if (!granted.ok) {
        setError({ code: granted.code, message: granted.error });
        return;
      }

      const started = await startAiJob(jobId, pending.sessionId);
      if (!alive.current) return;
      if (!started.ok) {
        setError({ code: started.code, message: started.error });
        const refreshed = await getAiJob(jobId);
        if (refreshed.ok && alive.current) applyJob(refreshed.job);
        return;
      }

      applyJob(started.job);
      if (started.usage) setUsage(started.usage);
      attempts.current = 0;
      void refreshEntitlement();
    } finally {
      if (alive.current) setBusy(false);
      awaitingRewardJobId.current = null;
    }
  }, [applyJob, pendingReward, refreshEntitlement]);

  /**
   * The ad was closed early.
   *
   * Nothing to undo: no allowance was reserved and no reward was granted, so
   * this only clears the gate. The job stays `queued` and the member may try
   * again — the brief is explicit that an abandoned ad must not be punished.
   */
  const cancelReward = useCallback(() => {
    setPendingReward(null);
    awaitingRewardJobId.current = null;
    setBusy(false);
  }, []);

  const cancel = useCallback(async () => {
    const current = jobRef.current;
    uploadAbort.current?.abort();
    setUploading(false);
    if (!current) return;

    const res = await cancelAiJob(current.id);
    if (!alive.current) return;
    if (res.ok) applyJob(res.job);
  }, [applyJob]);

  const reset = useCallback(() => {
    stopPolling();
    attempts.current = 0;
    applyJob(null);
    setError(null);
    setUploadFraction(0);
    setUploading(false);
  }, [applyJob, stopPolling]);

  const fetchResultUrl = useCallback(async (forDownload = false) => {
    const current = jobRef.current;
    if (!current) return null;
    const res = await getAiJobResult(current.id, forDownload);
    if (!res.ok) {
      setError({ code: res.code, message: res.error });
      return null;
    }
    return res.url;
  }, []);

  /*
    Deliberately silent on failure, unlike the result above. The comparison is
    an enhancement: if the original cannot be signed, the panel simply shows the
    finished video on its own. Raising an error for it would put a red message
    on a screen whose actual news is that the job succeeded.
  */
  const fetchSourceUrl = useCallback(async () => {
    const current = jobRef.current;
    if (!current) return null;
    const res = await getAiJobSource(current.id);
    return res.ok ? res.url : null;
  }, []);

  return {
    job,
    view: stageFor({ job, uploading, uploadFraction }),
    usage,
    error,
    restoring,
    busy,
    submit,
    cancel,
    reset,
    fetchResultUrl,
    fetchSourceUrl,
    entitlement,
    pendingReward,
    completeReward,
    cancelReward,
    refreshEntitlement,
  };
}
