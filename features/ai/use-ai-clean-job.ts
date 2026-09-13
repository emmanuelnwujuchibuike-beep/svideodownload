"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AI_JOB_STARTED_EVENT } from "@/lib/ai/history-cache";
import {
  cancelAiJob,
  createAiJob,
  getAiCleanEntitlement,
  getAiJob,
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

/**
 * What the member pointed AI Clean at.
 *
 * A `File` the browser is holding, or a link the SERVER will fetch (Part 6).
 * The browser never fetches the link — see lib/ai/source-url.ts for the
 * allow-list that decides whether the server will either.
 */
export type AiCleanInput = File | { url: string };

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
}

export interface AiCleanJobActions {
  /** Create, upload (a file only), start. The whole submission. */
  submit: (input: AiCleanInput) => Promise<void>;
  /** Stop a running job and give the slot back. */
  cancel: () => Promise<void>;
  /** Clear the finished/failed job so the member can choose another video. */
  reset: () => void;
  /** A short-lived link to the finished video, fetched when it is needed. */
  /** `forDownload` asks for a link that SAVES rather than plays — see client.ts. */
  fetchResultUrl: (forDownload?: boolean) => Promise<string | null>;
  /** The same for the ORIGINAL, so the result can be compared against it. */
  fetchSourceUrl: () => Promise<string | null>;
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
      /*
        ── 🔴 `?job=` IS THE PUSH NOTIFICATION'S OWN LINK, AND NOTHING READ IT ──

        `notifyAiCleanFinished` sends people to `/studio/ai/clean?job=<id>` —
        the whole point of the push being that they LEFT while the model ran.
        By the time they tap it the job is `completed`, and the restore below
        asks only for ACTIVE jobs, so every one of those taps landed on an empty
        picker: the notification said "your video is ready" and the page it
        opened showed no video at all. Exactly the disappearance the owner
        reported on 2026-09-09, arriving by a second route.

        A job named in the url is adopted whatever its status, because the
        member was sent here to look at that specific one. It is still THEIR
        job — `/api/ai/jobs/[id]` scopes by subject — so an id belonging to
        somebody else answers 404 and this falls through to the normal restore.
      */
      const requested =
        typeof window === "undefined"
          ? null
          : new URLSearchParams(window.location.search).get("job");

      const [named, jobs] = await Promise.all([
        requested ? getAiJob(requested) : Promise.resolve(null),
        listAiJobs({ feature: "ai_clean", limit: 1, active: true }),
        refreshEntitlement(),
      ]);
      if (!alive.current) return;

      if (named?.ok) {
        applyJob(named.job);
        /*
          Taken out of the url once it has been used. Otherwise "Clean another
          video" clears the job, and the next refresh — or a back-navigation —
          drags the finished one straight back over the picker. Same reasoning
          as the tutorial's `?tutorial=1`.
        */
        const url = new URL(window.location.href);
        url.searchParams.delete("job");
        window.history.replaceState({}, "", url.toString());
      } else if (jobs.ok && jobs.jobs.length > 0) {
        applyJob(jobs.jobs[0]!);
      }
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
    async (input: AiCleanInput) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setUploadFraction(0);

      /*
        ── 🔴 ONE SUBMISSION, TWO KINDS OF SOURCE (Part 6) ──────────────────

        A File and a link differ in exactly one place — whether the browser
        has bytes to send — and are identical everywhere else: the same
        idempotency key, the same allowance, the same start, the same polling.
        So this stayed ONE function rather than becoming two.

        Two `submit` implementations would be two copies of the same ordering,
        and the ordering is the part of this flow with real consequences if it
        drifts — the allowance is only ever spent inside `/start`.
      */
      const isLink = !(input instanceof File);

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
          source: isLink
            ? {
                kind: "url",
                url: input.url,
                /*
                  🔴 No size and no mimeType, and the server REFUSES a link
                  body that carries them. Nothing has been fetched, so any
                  number here would be invented — and the ceilings are applied
                  by the worker against the real file, which is the first
                  moment they can be true rather than claimed.
                */
              }
            : {
                kind: "upload",
                size: input.size,
                mimeType: input.type || "video/mp4",
                name: input.name,
              },
        });
        if (!alive.current) return;

        /*
          ── 🔴 TELL THE APP-WIDE ALERT THERE IS SOMETHING TO WATCH ──────────

          `AiJobAlert` (mounted in both layouts) decides whether to poll from
          `browserHasUsedAiClean()` — a localStorage check that is FALSE for
          somebody cleaning their first video, because nothing is cached yet.
          That is exactly the person most likely to be watching for the result,
          so without this the first clean would be the one clean that announced
          itself to nobody.

          A window event rather than shared state: the two components never
          meet, and a store between them would be a store to keep in sync.
          Dispatched even if `created` failed further down — the job row may
          already exist, and watching for a job that never appears costs one
          request.
        */
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event(AI_JOB_STARTED_EVENT));
        }

        if (!created.ok) {
          setError({ code: created.code, message: created.error });
          if (created.usage) setUsage(created.usage);
          return;
        }

        applyJob(created.job);
        if (created.usage) setUsage(created.usage);

        /*
          A link has no upload ticket by design — the browser must never fetch
          the address somebody pasted, and there is nothing for it to send. So
          the upload block is skipped entirely and `/start` hands the job to
          our worker instead.
        */
        if (!isLink) {
          if (!created.upload) {
            // The job exists but there is nowhere to put the file — it is
            // already past the point an upload belongs. Nothing to do but show
            // its state.
            return;
          }

          setUploading(true);
          uploadAbort.current = new AbortController();
          const sent = await uploadSource({
            ticket: created.upload,
            file: input,
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
        }

        /*
          ── 🔴 THERE IS NO AD BETWEEN THE UPLOAD AND THE START ────────────────

          Owner, 2026-09-13: "since the last fix the ai clean is stuck at queued
          58% for long now."

          A rewarded-ad gate used to sit exactly here for free members: open a
          session, show the downloader's `RewardedAdGate`, and call `/start`
          only from its `onReward`. When the ad network served nothing — it was
          never keyed for this feature — nothing fired, `/start` was never sent,
          and the job sat in `queued` while the bar crept to that stage's 58%
          ceiling. Every stuck row had `started_at: null`.

          The standing Frenz AI rule (§6, 2026-09-09) had already removed ads
          from the economy: free allowance, then prepaid balance, nothing else.
          So the upload goes straight to the start, for everyone.
        */
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
    refreshEntitlement,
  };
}
