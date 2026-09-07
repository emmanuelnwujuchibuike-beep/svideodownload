"use client";

import type { AiErrorCode } from "@/lib/ai/errors";
import type { AiFeature, AiJobSourceInput, AiJobView } from "@/lib/ai/jobs";

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
 * ── 🔴 NOTHING CALLS THIS YET, AND THAT IS THE DECISION ──────────────────────
 *
 * Part 2's frontend integration is deliberately this module and no wiring. The
 * AI Clean workspace does NOT create a job when someone presses Continue,
 * because no provider exists to run one: every row it made would sit at
 * `queued` in that member's history forever, and a queue with no worker is the
 * closest thing to fake progress this feature could ship. The interface already
 * says the cleanup is not connected; that stays true until it is.
 *
 * What Part 3 changes is one call site, not this file.
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
}): Promise<AiJobResult<{ job: AiJobView; created: boolean; usage?: AiJobUsage; dispatch: AiJobDispatch }>> {
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
}): Promise<AiJobResult<{ jobs: AiJobView[]; nextCursor: string | null }>> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.feature) params.set("feature", opts.feature);
  const query = params.toString();
  return request(`/api/ai/jobs${query ? `?${query}` : ""}`);
}
