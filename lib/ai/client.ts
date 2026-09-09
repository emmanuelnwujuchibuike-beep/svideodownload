"use client";

import type { AiErrorCode } from "@/lib/ai/errors";
import type { AiFeature, AiJobSourceInput, AiJobStatus, AiJobView } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the browser's side of the job API
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The one place the UI talks to `/api/ai/jobs`. Thin on purpose: it sends what
 * the route accepts, and it turns both outcomes into a value rather than
 * throwing on one of them, so a caller handles a refusal the same way it
 * handles success.
 *
 * ── The upload never passes through our server ───────────────────────────────
 *
 * `createAiJob` comes back with a signed, single-object upload ticket and
 * `uploadSource` PUTs the file straight to storage. A 100 MB video therefore
 * costs us nothing but two small JSON round trips, instead of a serverless
 * invocation holding 100 MB of somebody else's memory.
 *
 * The PUT is an XMLHttpRequest rather than `fetch` for one reason: it reports
 * upload progress. That number is the only real percentage in this feature —
 * bytes the browser has actually sent — and it is why the progress bar can move
 * during the upload and must not during processing.
 */

export interface AiJobUsage {
  plan: string;
  unlimited: boolean;
  /** null when the plan is not capped. */
  limit: number | null;
  used: number;
  remaining: number | null;
}

export interface AiJobDispatch {
  /** False means the job is recorded and nothing will run it. */
  ready: boolean;
  reason?: string;
}

export type AiJobResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: AiErrorCode | "NETWORK"; error: string; usage?: AiJobUsage };

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<AiJobResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    // A dropped mobile connection is not a server refusal, and a caller that
    // cannot tell them apart will either retry something it should not or give
    // up on something it should retry.
    return { ok: false, code: "NETWORK", error: "You appear to be offline. Try again in a moment." };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* an empty or non-JSON body is handled below */
  }

  if (!res.ok) {
    const b = (body ?? {}) as { code?: AiErrorCode; error?: string; usage?: AiJobUsage };
    return {
      ok: false,
      code: b.code ?? "INTERNAL_ERROR",
      error: b.error ?? "Something went wrong. Try again in a moment.",
      usage: b.usage,
    };
  }

  return { ok: true, ...((body ?? {}) as T) };
}

/**
 * An idempotency key.
 *
 * 🔴 Generate this ONCE per thing the member meant to do, and reuse it for
 * every retry of that same thing. A key made fresh on each attempt is not an
 * idempotency key at all — it is a new job, which is exactly the duplicate the
 * mechanism exists to prevent. The route matches on it per member, so it needs
 * no secrecy, only stability.
 */
export function newClientRequestId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    // Older WebViews have no randomUUID. Length and alphabet still satisfy the
    // server's shape check; uniqueness only has to hold within one account.
    return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

export async function createAiJob(input: {
  feature: AiFeature;
  source: AiJobSourceInput;
  clientRequestId: string;
}): Promise<
  AiJobResult<{
    job: AiJobView;
    created: boolean;
    upload: AiUploadTicket | null;
    usage?: AiJobUsage;
    dispatch: AiJobDispatch;
  }>
> {
  return request("/api/ai/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getAiJob(id: string): Promise<AiJobResult<{ job: AiJobView }>> {
  return request(`/api/ai/jobs/${encodeURIComponent(id)}`);
}

export async function listAiJobs(opts?: {
  limit?: number;
  cursor?: string | null;
  feature?: AiFeature;
  /** Only jobs that can still change — what a returning member asks for. */
  active?: boolean;
  /**
   * The history tabs. An EMPTY array is "no filter", not "match nothing" —
   * see `statusesForFilter` in lib/ai/history.ts for why "All" sends none.
   */
  statuses?: readonly AiJobStatus[];
}): Promise<AiJobResult<{ jobs: AiJobView[]; nextCursor: string | null }>> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.feature) params.set("feature", opts.feature);
  if (opts?.active) params.set("active", "1");
  if (opts?.statuses?.length) params.set("status", opts.statuses.join(","));
  const query = params.toString();
  return request(`/api/ai/jobs${query ? `?${query}` : ""}`);
}

export interface AiUploadTicket {
  path: string;
  uploadUrl: string;
  expiresIn: number;
}

/**
 * Send the file to the signed target.
 *
 * Resolves `true` on a 2xx and `false` on anything else — including an abort,
 * because a cancelled upload is not an error to report, it is a thing that
 * stopped. The caller decides what to say.
 */
export function uploadSource(opts: {
  ticket: AiUploadTicket;
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", opts.ticket.uploadUrl, true);
    // Storage stores what it is told; without this every object would land as
    // application/octet-stream and the server's own MIME check would refuse it.
    xhr.setRequestHeader("content-type", opts.file.type || "video/mp4");
    // A retry of the same job writes the same key. Without upsert the second
    // attempt fails on a duplicate rather than replacing a half-written object.
    xhr.setRequestHeader("x-upsert", "true");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.onabort = () => resolve(false);

    opts.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(opts.file);
  });
}

/**
 * Tell the server the upload landed and processing may begin.
 *
 * `rewardSessionId` is an AUTHORIZATION, not a setting: the server decides
 * whether one is needed and the database decides whether that one is spendable.
 * Sending it when none is owed changes nothing.
 */
export async function startAiJob(
  id: string,
  rewardSessionId?: string,
): Promise<AiJobResult<{ job: AiJobView; started: boolean; usage?: AiJobUsage }>> {
  return request(`/api/ai/jobs/${encodeURIComponent(id)}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(rewardSessionId ? { rewardSessionId } : {}),
  });
}

/**
 * What this member may do right now.
 *
 * 🔴 FOR DISPLAY ONLY. Every value here is re-resolved server-side when a job
 * is actually started — a plan can change, another tab can spend the last slot,
 * and this object lives in a browser the member controls. Rendering from it is
 * fine; deciding from it would be a bug.
 */
export interface AiCleanEntitlement {
  plan: string;
  /** False when an operator has switched free access off — a different state. */
  offered: boolean;
  unlimited: boolean;
  dailyLimit: number | null;
  usedToday: number;
  remainingToday: number | null;
  rewardRequired: boolean;
  rewardsPerJob: number;
  canStart: boolean;
  /** True only when this member really is on the faster hardware today. */
  gpuAccelerated?: boolean;
  /** True when a GPU model exists on this deployment at all — gates the upsell. */
  gpuOffered?: boolean;
  /** True when the BRIA model exists — gates the Max AI label. */
  briaOffered?: boolean;
  /** "standard" | "gpu" | "bria" — what this member runs on today. */
  modelTier?: string;
}

export async function getAiCleanEntitlement(): Promise<AiJobResult<AiCleanEntitlement>> {
  return request("/api/ai/clean/entitlement");
}

/** Open a short-lived reward session. The server binds it to this member. */
export async function openAiRewardSession(): Promise<
  AiJobResult<{ sessionId: string; expiresAt: string; verifiable: boolean }>
> {
  return request("/api/ai/clean/reward", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "open" }),
  });
}

/**
 * Report that the ad finished.
 *
 * ⚠️ This is an ATTESTATION, not proof — no ad network wired to this site can
 * verify a web rewarded ad (see lib/ai/reward.ts). The server treats it as such:
 * the grant it produces is single-use, expiring, bound to this member and this
 * feature, and cannot buy a session the daily allowance does not already hold.
 */
export async function grantAiReward(
  sessionId: string,
): Promise<AiJobResult<{ granted: boolean; sessionId: string }>> {
  return request("/api/ai/clean/reward", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "grant", sessionId }),
  });
}

/** Stop a job that is still queued or processing. */
export async function cancelAiJob(
  id: string,
): Promise<AiJobResult<{ job: AiJobView; cancelled: boolean }>> {
  return request(`/api/ai/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

/**
 * A short-lived link to the finished video.
 *
 * Fetched on demand rather than carried on the job, because the link expires in
 * minutes: one held in component state across a long session would be dead by
 * the time somebody pressed Download.
 */
export async function getAiJobResult(
  id: string,
  /**
   * Ask for a link that SAVES rather than plays.
   *
   * 🔴 The `download` attribute on an `<a>` is ignored for cross-origin URLs,
   * and a Supabase signed URL is cross-origin. Without this the browser simply
   * opens the video. The flag makes storage send a `Content-Disposition`, which
   * is obeyed everywhere. See `signResultUrl`.
   */
  forDownload = false,
): Promise<AiJobResult<{ url: string; expiresIn: number; size: number | null }>> {
  const suffix = forDownload ? "?download=1" : "";
  return request(`/api/ai/jobs/${encodeURIComponent(id)}/result${suffix}`);
}

/**
 * A short-lived link to the member's ORIGINAL, for the before/after.
 *
 * Same lifetime and same ownership rules as the result — a source file is not
 * less private than a result. Fetched on demand for the same reason: a link
 * held in state across a session is dead by the time anybody uses it.
 */
export async function getAiJobSource(
  id: string,
): Promise<AiJobResult<{ url: string; expiresIn: number }>> {
  return request(`/api/ai/jobs/${encodeURIComponent(id)}/source`);
}
