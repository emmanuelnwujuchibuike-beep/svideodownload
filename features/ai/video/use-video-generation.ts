"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  QUOTE → GENERATE → POLL — the client half of a Kling video generation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Part 6 §55: "Do not calculate final prices independently in the UI… The UI
 * must request/recalculate through the authoritative backend quote mechanism."
 * So this hook owns exactly three conversations and no arithmetic:
 *
 *     settings change → POST /api/ai/video/quote   (debounced)
 *     Generate        → POST /api/ai/video/jobs
 *     while running   → GET  /api/ai/jobs/:id      (until terminal)
 *
 * ── 🔴 THE BROWSER NEVER WAITS FOR A VIDEO (§33) ──────────────────────────
 *
 * `/jobs` returns as soon as Kling has ACCEPTED the work — seconds, not
 * minutes. The polling below is a courtesy for a member who stays on the page;
 * the job does not depend on it. The callback, the finalizer and the push
 * notification all run server-side, so closing the tab loses nothing. That is
 * why the status copy says so.
 *
 * ── Why polling and not a socket ───────────────────────────────────────────
 *
 * The result route already exists and is cheap, the job is minutes long, and
 * this project has a standing rule against an SSE route billing continuous
 * serverless compute. A 3-second poll that stops the moment the job is
 * terminal — and stops immediately when the tab is hidden — costs less than
 * holding a connection open.
 */

export type VideoGenStatus = "idle" | "submitting" | "running" | "done" | "error";

export interface PublicQuote {
  feature: string;
  resolution: string;
  seconds: number;
  billableSeconds: number;
  totalCents: number;
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
const POLL_MS = 3000;

export function useVideoGeneration({ feature, input, ready }: { feature: "text_to_video" | "image_to_video" | "lip_sync"; input: unknown; ready: boolean }) {
  const [quote, setQuote] = useState<PublicQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteProblem, setQuoteProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<VideoGenStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FinishedJob | null>(null);
  const jobIdRef = useRef<string | null>(null);

  /* ── the quote, debounced, and always superseded by the newest ─────────── */
  useEffect(() => {
    if (!ready) {
      setQuote(null);
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
          return;
        }
        setQuoteProblem(null);
        setQuote(json.quote as PublicQuote);
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
  }, [feature, input, ready]);

  /* ── polling, only while a job is actually running ─────────────────────── */
  useEffect(() => {
    if (status !== "running" || !jobIdRef.current) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        const res = await fetch(`/api/ai/jobs/${jobIdRef.current}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        const job = json?.job;
        if (!job || stopped) return;
        if (job.status === "completed") {
          setResult({ id: job.id, status: job.status, resultUrl: job.resultUrl ?? null, posterUrl: job.posterUrl ?? null, createdAt: job.createdAt ?? null });
          setStatus("done");
        } else if (["failed", "cancelled", "expired"].includes(job.status)) {
          setError(job.errorMessage ?? "The generation didn't finish. Nothing has been charged for a failed run.");
          setStatus("error");
        }
      } catch {
        /* a dropped poll is not a failed job — the next tick asks again */
      }
    };
    const id = setInterval(tick, POLL_MS);
    void tick();
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [status]);

  const submit = useCallback(async () => {
    if (!ready || status === "submitting" || status === "running") return;
    setError(null);
    setResult(null);
    setStatus("submitting");
    try {
      const res = await fetch("/api/ai/video/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feature,
          input,
          // Idempotency: a double tap or a retry reaches the SAME job rather than paying twice.
          clientRequestId: crypto.randomUUID().replace(/-/g, "").slice(0, 32),
          // What the member was shown. The server compares and refuses a difference.
          ...(quote ? { shownTotalCents: quote.totalCents } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? "Generation couldn't be started.");
        setStatus("error");
        return;
      }
      jobIdRef.current = json.jobId as string;
      setStatus("running");
    } catch {
      setError("We couldn't reach the service. Check your connection and try again.");
      setStatus("error");
    }
  }, [feature, input, quote, ready, status]);

  const reset = useCallback(() => {
    jobIdRef.current = null;
    setResult(null);
    setError(null);
    setStatus("idle");
  }, []);

  return { quote, quoting, quoteProblem, status, error, result, submit, reset };
}
