"use client";

import { getAiJob, getAiJobResult } from "@/lib/ai/client";
import { AI_JOB_STARTED_EVENT } from "@/lib/ai/history-cache";
import { isActiveStatus, type AiJobStatus } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE RUNNING GENERATION — one record, outside React, and ONE poll
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-04, after the first real Kling runs:
 *
 *   a. "the phone OVERHEATS while a generation runs"
 *   b. "the progress card must SURVIVE leaving the page, and show
 *       'completed — view' if it finishes while I'm on it"
 *
 * Both are the same defect wearing two hats: the generation lived in
 * `useVideoGeneration`'s component state, so it died on navigation (b) — and
 * because it died, it had to be re-established aggressively while it was
 * alive (a). A module-level store fixes the first and makes the second
 * affordable.
 *
 * The shape is `features/downloads/manager.ts`, deliberately and not by
 * accident: module state + `useSyncExternalStore` + a `requestAnimationFrame`
 * coalesced notify. That file carries the comment "the landing page becomes
 * worse and overheats when I fetch multiple downloads media" — the same
 * report, already solved once. Reusing the solved shape is the point.
 *
 * ── 🔴 WHY THE OLD POLL WAS HEAT FOR NO INFORMATION ─────────────────────────
 *
 * It ran `setInterval(tick, 3000)` for the whole generation. A Kling video
 * takes about two minutes, so that is ~40 requests, each one a radio wake-up,
 * a TLS round trip, a Vercel function invocation and a React render.
 *
 * And it bought NOTHING. Kling reports `submitted / processing / succeeded /
 * failed` and nothing between — there is no percentage, which is exactly why
 * the UI draws an indeterminate shuttle (`frenz-ai-indeterminate`, and the
 * comment there says a bar that creeps to 90% would be a fabricated
 * statistic). Polling three times a second-and-a-bit to learn "still
 * processing" is work with no observable output. The ONLY thing a poll can
 * discover is the terminal transition, and a member cannot perceive learning
 * that 4 seconds sooner.
 *
 * So the schedule below is paced to the job, not to the spinner. Measured in
 * requests rather than degrees, which is the honest unit available here:
 *
 *     before   ~40 requests over a 2-minute generation
 *     after    ~14   (5s while it settles, 10s through the body, 15s after)
 *
 * It also still stops dead on a hidden tab — and unlike the old loop, which
 * kept firing a no-op `tick` every 3s while hidden, this one cancels the
 * timer outright and takes one look when the tab comes back.
 *
 * ── 🔴 AT REST THIS COSTS EXACTLY ZERO ──────────────────────────────────────
 *
 * The hard law ([[hard-law-never-ship-idle-consumption-2026-10-04]]) asks what
 * a thing costs at 3am with nobody on the site. No generation means no record,
 * no timer, no listener and no request: the poll is armed BY a running job and
 * disarms itself the moment the job is terminal.
 *
 * ── A SIGNED URL IS NEVER PERSISTED ─────────────────────────────────────────
 *
 * The record survives a reload through `sessionStorage`, but `resultUrl` is a
 * short-lived signed link and is deliberately stripped before writing. A
 * restored record re-mints it. Storing it would reload a dead URL and render
 * a broken video — the failure mode `getAiJobResult`'s own comment warns about
 * ("a link held in state across a session is dead by the time anybody uses
 * it").
 */

export type GenerationPhase = "running" | "completed" | "failed";

export type VideoFeature = "text_to_video" | "image_to_video" | "lip_sync";

export interface ActiveGeneration {
  jobId: string;
  feature: VideoFeature;
  /** What the member asked for, trimmed — the card's one line of context. */
  label: string;
  /** Where "View" goes: the workspace that started it. */
  href: string;
  phase: GenerationPhase;
  status: AiJobStatus | "submitting";
  /** Epoch ms. Drives the poll schedule and the card's elapsed time. */
  startedAt: number;
  /** Minted on completion, never persisted. */
  resultUrl: string | null;
  posterUrl: string | null;
  error: string | null;
  /** The member closed a finished card. The record stays; the card does not. */
  dismissed: boolean;
  /**
   * Tucked to the side as a pill (owner, 2026-10-04: "make users able to hide
   * this floating progress bar to go beside and they can see the progress
   * without it occupying the screen").
   *
   * 🔴 On the RECORD rather than in component state, which is where the
   * downloads card keeps the same flag. That card never outlives its page, so
   * local state is right for it; this one deliberately survives navigation, so
   * local state would re-expand the card on every route change — re-imposing
   * the thing the member just asked to get out of the way.
   */
  minimised: boolean;
}

const STORAGE_KEY = "frenz:ai:active-generation";

let current: ActiveGeneration | null = null;
const listeners = new Set<() => void>();

/* ───────────────────────────── notify, once a frame ─────────────────────── */

let frame: number | null = null;

function flush() {
  if (frame !== null) {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    frame = null;
  }
  for (const l of listeners) l();
}

/**
 * `immediate` for the states somebody is actually waiting for.
 *
 * The frame-coalescing exists to stop a burst of writes re-rendering the app
 * several times a frame. It must never delay "your video is ready", which
 * happens once and is the whole point of the card.
 */
function emit(immediate = false) {
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

function set(next: ActiveGeneration | null, immediate = false) {
  current = next;
  persist();
  emit(immediate);
}

function patch(next: Partial<ActiveGeneration>, immediate = false) {
  if (!current) return;
  set({ ...current, ...next }, immediate);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): ActiveGeneration | null {
  return current;
}

/**
 * Always null on the server.
 *
 * 🔴 It must also be null on the client's FIRST paint, which is why the
 * restore below runs from an effect and not at module scope. Reading
 * `sessionStorage` during render would produce markup the server could not
 * have produced, and hydration would mismatch.
 */
export function getServerSnapshot(): ActiveGeneration | null {
  return null;
}

/* ───────────────────────────── persistence ──────────────────────────────── */

function persist() {
  try {
    if (!current) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    // The signed URL is dropped on the way out. See the header note.
    const { resultUrl: _resultUrl, ...durable } = current;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(durable));
  } catch {
    /*
      Private mode, blocked site data, a full quota. The store works perfectly
      well in memory for the life of the page — persistence is an improvement
      on navigation, never a requirement.
    */
  }
}

/**
 * Bring back a generation from a previous page. Called once, from an effect.
 *
 * A record that is still `running` re-arms the poll, so a member who reloads
 * mid-generation keeps their card and still gets told when it lands.
 */
export function restoreActiveGeneration(): void {
  if (current) return;
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveGeneration>;
    if (!parsed || typeof parsed.jobId !== "string" || typeof parsed.startedAt !== "number") {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    current = {
      jobId: parsed.jobId,
      feature: (parsed.feature ?? "text_to_video") as VideoFeature,
      label: typeof parsed.label === "string" ? parsed.label : "",
      href: typeof parsed.href === "string" ? parsed.href : "/studio/ai/history",
      phase: parsed.phase === "completed" || parsed.phase === "failed" ? parsed.phase : "running",
      status: (parsed.status ?? "processing") as AiJobStatus,
      startedAt: parsed.startedAt,
      resultUrl: null,
      posterUrl: typeof parsed.posterUrl === "string" ? parsed.posterUrl : null,
      error: typeof parsed.error === "string" ? parsed.error : null,
      dismissed: parsed.dismissed === true,
      minimised: parsed.minimised === true,
    };
    emit(true);
    if (current.phase === "running") armPoll();
    // A finished job restored from storage still needs a fresh playable link.
    else if (current.phase === "completed" && !current.resultUrl) void mintResult(current.jobId);
  } catch {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing further to do */
    }
  }
}

/* ───────────────────────────── the public verbs ─────────────────────────── */

export function startGeneration(opts: { jobId: string; feature: VideoFeature; label: string; href: string }): void {
  set(
    {
      jobId: opts.jobId,
      feature: opts.feature,
      label: opts.label.trim().slice(0, 140),
      href: opts.href,
      phase: "running",
      status: "queued",
      startedAt: Date.now(),
      resultUrl: null,
      posterUrl: null,
      error: null,
      dismissed: false,
      // A new generation always opens expanded — the member asked for this one.
      minimised: false,
    },
    true,
  );
  /*
    Tell the app-wide alert a job exists. It arms `AiJobAlertMount` for a
    first-time member, whose browser has no "has used Frenz AI" key yet — the
    exact case its own gate cannot see.
  */
  try {
    window.dispatchEvent(new Event(AI_JOB_STARTED_EVENT));
  } catch {
    /* non-browser */
  }
  armPoll();
}

/** The member closed the finished card. The record stays readable; the card goes. */
export function dismissGeneration(): void {
  if (!current) return;
  if (current.phase === "running") return; // a running job is not dismissible
  patch({ dismissed: true }, true);
}

/** Tuck the card to the side, or bring it back. Survives navigation. */
export function setGenerationMinimised(minimised: boolean): void {
  if (!current) return;
  patch({ minimised }, true);
}

/** Start over — "Make another" clears the slate. */
export function clearGeneration(): void {
  stopPoll();
  set(null, true);
}

/* ───────────────────────────── the one poll ─────────────────────────────── */

/**
 * Paced to the job. See the header: a faster poll cannot learn anything
 * Kling is willing to say.
 */
export function generationPollIntervalMs(elapsedMs: number): number {
  if (elapsedMs < 20_000) return 5_000;
  if (elapsedMs < 120_000) return 10_000;
  return 15_000;
}
const intervalFor = generationPollIntervalMs;

/**
 * A generation that has been running this long is not coming back. The server
 * owns the real deadline (the stall sweep and the 45-minute expiry); this is
 * only the browser deciding to stop asking, so a tab left open overnight on a
 * job that died in some way we never heard about is not a timer for ever.
 */
const GIVE_UP_AFTER_MS = 45 * 60_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let watching = false;

function stopPoll() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (watching && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibility);
    watching = false;
  }
}

function onVisibility() {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "visible") {
    /*
      Back on screen: take one look immediately rather than waiting out the
      remainder of an interval that was never scheduled while hidden.
    */
    void tick();
  } else if (timer) {
    // 🔴 Cancel the timer outright. The old loop kept firing a no-op every 3s
    // while hidden, which is a wake-up for a function that returns at once.
    clearTimeout(timer);
    timer = null;
  }
}

function armPoll() {
  if (typeof document === "undefined") return;
  if (!watching) {
    document.addEventListener("visibilitychange", onVisibility);
    watching = true;
  }
  schedule();
}

function schedule() {
  if (timer || !current || current.phase !== "running") return;
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const elapsed = Date.now() - current.startedAt;
  timer = setTimeout(() => {
    timer = null;
    void tick();
  }, intervalFor(elapsed));
}

async function tick(): Promise<void> {
  if (!current || current.phase !== "running") {
    stopPoll();
    return;
  }
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

  if (Date.now() - current.startedAt > GIVE_UP_AFTER_MS) {
    stopPoll();
    return;
  }

  const jobId = current.jobId;
  const res = await getAiJob(jobId);
  // A dropped poll is not a failed job — ask again on the next beat.
  if (!res.ok) {
    schedule();
    return;
  }
  // The record changed underneath us (a new generation started). Drop this.
  if (!current || current.jobId !== jobId) return;

  const job = res.job;
  if (job.status === "completed") {
    patch({ phase: "completed", status: job.status, posterUrl: job.result.hasPoster ? `/api/ai/jobs/${encodeURIComponent(jobId)}/poster` : null }, true);
    stopPoll();
    await mintResult(jobId);
    return;
  }
  if (!isActiveStatus(job.status)) {
    patch(
      {
        phase: "failed",
        status: job.status,
        error:
          job.status === "cancelled"
            ? "You stopped this generation."
            : "The generation didn't finish. Anything charged for it has been returned.",
      },
      true,
    );
    stopPoll();
    return;
  }

  // Still going. Record the stage so the card can say something true.
  if (job.status !== current.status) patch({ status: job.status });
  schedule();
}

/**
 * Mint the playable link.
 *
 * 🔴 This step did not exist, and without it a SUCCESSFUL generation showed
 * "Preparing your video…" for ever. The old hook read `job.resultUrl` off
 * `/api/ai/jobs/:id` — a field that route has never returned. The result is a
 * separate, ownership-checked, short-lived signed URL from
 * `/api/ai/jobs/:id/result`, and somebody has to ask for it.
 */
async function mintResult(jobId: string): Promise<void> {
  const res = await getAiJobResult(jobId);
  if (!current || current.jobId !== jobId) return;
  if (!res.ok) {
    /*
      The video is finished and safely stored — only the link failed. Say
      nothing alarming: the card keeps its "ready" state and "View" goes to
      the history page, which mints its own.
    */
    return;
  }
  patch({ resultUrl: res.url }, true);
}
