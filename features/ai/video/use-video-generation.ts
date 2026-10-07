"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { createIdempotencyKeyHolder, type IdempotencyKeyHolder } from "@/features/ai/video/idempotency-key";
import {
  clearGeneration,
  getServerSnapshot,
  getSnapshot,
  restoreActiveGeneration,
  startGeneration,
  subscribe,
  type VideoFeature,
} from "@/features/ai/video/active-generation";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUOTE → GENERATE → WATCH — the client half of a Kling video generation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 6 §55: "Do not calculate final prices independently in the UI… The UI
 * must request/recalculate through the authoritative backend quote mechanism."
 * So this hook owns the quote conversation and no arithmetic:
 *
 *     settings change → POST /api/ai/video/quote   (debounced)
 *     Generate        → POST /api/ai/video/jobs
 *
 * ── 🔴 THE RUNNING JOB IS NOT STATE IN THIS COMPONENT ANY MORE ─────────────
 *
 * It used to be: a `jobIdRef`, a `status`, and a `setInterval` polling every
 * 3 seconds. Two consequences, both reported by the owner on 2026-10-04 after
 * the first real Kling runs:
 *
 *   · navigating away LOST the generation — the id lived in a ref that
 *     unmounted with the page, so the card vanished and nothing was watching;
 *   · the phone got hot — ~40 requests over a two-minute generation, each a
 *     radio wake-up and a React render, for a provider that reports no
 *     progress to learn.
 *
 * Both now belong to `features/ai/video/active-generation.ts`: module-level
 * state, one visibility-gated poll on a schedule paced to the job, and
 * `sessionStorage` so a reload keeps the card. The reasoning is all in that
 * file's header. This hook subscribes and renders.
 *
 * ── 🔴 THE BROWSER NEVER WAITS FOR A VIDEO (§33) ──────────────────────────
 *
 * `/jobs` returns as soon as Kling has ACCEPTED the work — seconds, not
 * minutes. The watching is a courtesy for a member who stays; the job does not
 * depend on it. The callback, the finalizer and the push notification all run
 * server-side, so closing the tab loses nothing.
 */

export type VideoGenStatus = "idle" | "submitting" | "running" | "done" | "error";

export interface PublicQuote {
  feature: string;
  resolution: string;
  seconds: number;
  billableSeconds: number;
  totalCents: number;
  /** 0184: what the member is charged, in credits — the figure shown. */
  credits: number | null;
  pricingVersion: number;
}

export interface FinishedJob {
  id: string;
  status: string;
  resultUrl: string | null;
  posterUrl: string | null;
  createdAt: string | null;
}

/** The debounce on re-quoting: long enough to not fire per keystroke, short enough to feel live. */
const QUOTE_DEBOUNCE_MS = 400;

export function useVideoGeneration({
  feature,
  input,
  ready,
  /** One line of context for the progress card — the prompt, usually. */
  label = "",
}: {
  feature: VideoFeature;
  input: unknown;
  ready: boolean;
  label?: string;
}) {
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteProblem, setQuoteProblem] = useState<string | null>(null);
  /** These settings would be the member's complimentary video (3 s · 720p · no reference video) — the server's answer, display only. */
  const [complimentary, setComplimentary] = useState(false);
  /** A submit in flight, and a submit that failed before a job ever existed. */
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /*
    ── THE IDEMPOTENCY KEY, HELD ACROSS RETRIES ────────────────────────────────

    🔴 This used to be minted inline at the fetch — `crypto.randomUUID()` in the
    request body — under a comment promising "a double tap or a retry reaches
    the SAME job rather than paying twice". A fresh uuid per call is the exact
    opposite: the key was never reused, so the server's idempotency could never
    fire and a retry bought a SECOND generation.

    The reachable path is not the double tap (the `submitting` flag covers the
    realistic case) — it is a LOST RESPONSE. If the POST reaches the server,
    creates the job and takes the money, but the reply dies on the way back,
    the member sees "We couldn't reach the service" and taps again. On this
    stack that is not hypothetical: an origin 502 arrives as Cloudflare's own
    HTML page, so the client cannot even tell a refusal from a lost reply.

    The rule lives in `idempotency-key.ts` rather than here because this repo
    has no DOM test environment — inside the hook it was untestable, which is
    how a false promise sat in a money path. See that file for the server half
    and `idempotency-key.test.ts` for the retry case proved both ways.
  */
  const keysRef = useRef<IdempotencyKeyHolder | null>(null);
  // Lazily, once: `useRef(createIdempotencyKeyHolder())` would build a holder
  // on every render and throw all but the first away.
  keysRef.current ??= createIdempotencyKeyHolder();
  const keys = keysRef.current;
  /*
    What makes two submits "the same request". Only the billable facts: the
    tool and its inputs. `label` is presentational and `quote` is derived, so
    neither may force a new key.
  */
  const requestFingerprint = useMemo(() => JSON.stringify({ feature, input }), [feature, input]);

  const active = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /*
    Bring back a generation started on another page, once, from an effect —
    never during render, because `sessionStorage` does not exist on the server
    and reading it while rendering would mismatch hydration.
  */
  useEffect(() => {
    restoreActiveGeneration();
  }, []);

  /*
    ── 🔴 RE-QUOTE ON A PRICED CHANGE, NOT ON A KEYSTROKE (2026-10-05) ───────

    This effect was keyed on the whole `input`, prompt text included, so every
    pause while typing a prompt was a POST to /api/ai/video/quote — a Vercel
    invocation and a rate-limiter read — for an answer that cannot change: the
    pipelines price duration, resolution, audio and the references
    (lib/ai/kling/pipelines/{text,image}-to-video.ts `quote`), never the words.
    Brief B §15: "avoid requesting on every keystroke … only recalculate when a
    pricing-relevant setting changes".

    So the trigger is the input WITHOUT its prompt; the request still carries
    the current full input (read through a ref), so the server validates
    exactly what it did before. `ready` still gates it, so the first character
    typed asks once.
  */
  const inputRef = useRef(input);
  inputRef.current = input;
  const pricedKey = useMemo(() => JSON.stringify({ feature, priced: withoutPrompt(input) }), [feature, input]);

  /* ── the quote, debounced, and always superseded by the newest ─────────── */
  useEffect(() => {
    const input = inputRef.current;
    if (!ready) {
      setQuote(null);
      setComplimentary(false);
      setQuoteProblem(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setQuoting(true);
      try {
        const res = await fetch("/api/ai/video/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feature, input }),
          signal: controller.signal,
        });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setQuoteProblem(json?.error ?? "This can't be priced right now.");
          return;
        }
        if (json?.ok === false) {
          // A capability refusal or a validation refusal: the server's sentence, verbatim.
          setQuoteProblem(json.capability?.reason ?? json.reason ?? "This can't be priced right now.");
          setQuote(null);
          setComplimentary(false);
          return;
        }
        setQuoteProblem(null);
        setQuote(json.quote as PublicQuote);
        setComplimentary(json.complimentary?.eligible === true);
      } catch {
        // An aborted request is the NEXT keystroke's job, not an error to show.
        if (!cancelled && !controller.signal.aborted) setQuoteProblem("This can't be priced right now.");
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
    // `pricedKey` stands in for `input` on purpose — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature, pricedKey, ready]);

  /*
    The record is only THIS tool's business when it belongs to this tool. A
    lip-sync running in another tab's workspace must not light up the Text to
    Video page as though it were its own.
  */
  const mine = active && active.feature === feature ? active : null;

  const status: VideoGenStatus = submitting
    ? "submitting"
    : submitError
      ? "error"
      : !mine
        ? "idle"
        : mine.phase === "running"
          ? "running"
          : mine.phase === "completed"
            ? "done"
            : "error";

  const result: FinishedJob | null = useMemo(() => {
    if (!mine || mine.phase !== "completed") return null;
    return {
      id: mine.jobId,
      status: "completed",
      resultUrl: mine.resultUrl,
      posterUrl: mine.posterUrl,
      createdAt: new Date(mine.startedAt).toISOString(),
    };
  }, [mine]);

  const error = submitError ?? (mine && mine.phase === "failed" ? mine.error : null);

  const submit = useCallback(async () => {
    if (!ready || submitting || (mine && mine.phase === "running")) return;
    setSubmitError(null);
    // A fresh run replaces whatever the card was showing.
    clearGeneration();
    setSubmitting(true);
    try {
      const res = await fetch("/api/ai/video/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature,
          input,
          // Idempotency: a double tap or a retry reaches the SAME job rather
          // than paying twice. Held in a ref so a RETRY sends the same key —
          // see idempotency-key.ts.
          clientRequestId: keys.for(requestFingerprint),
          // What the member was shown. The server compares and refuses a difference.
          ...(quote ? { shownTotalCents: quote.totalCents } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setSubmitError(json?.error ?? "Generation couldn't be started.");
        return;
      }
      // The job exists and is paid for. The next submit is a NEW request and
      // must not reuse this key, or the server would hand back this same job.
      keys.clear();
      startGeneration({
        jobId: json.jobId as string,
        feature,
        label,
        // "View" goes back to the workspace that started it.
        href: typeof window === "undefined" ? "/studio/ai/history" : window.location.pathname,
      });
    } catch {
      setSubmitError("We couldn't reach the service. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }, [feature, input, keys, label, mine, quote, ready, requestFingerprint, submitting]);

  const reset = useCallback(() => {
    setSubmitError(null);
    clearGeneration();
  }, []);

  return { quote, quoting, quoteProblem, complimentary, status, error, result, submit, reset };
}

/** The input as the PRICE sees it: everything but the prompt text. Exported for the test. */
export function withoutPrompt(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const { prompt: _prompt, ...rest } = input as Record<string, unknown>;
  return rest;
}
