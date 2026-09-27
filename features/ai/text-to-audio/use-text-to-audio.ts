"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useJobWatch } from "@/features/ai/character-replace/use-job-watch";
import { newClientRequestId } from "@/lib/ai/client";
import { generateTextToAudio, getTextToAudioConfig, getTextToAudioQuote, type TtaConfigAnswer, type TtaQuoteAnswer } from "@/lib/ai/text-to-audio/client";
import { track } from "@/lib/analytics/client";
import type { TtsDelivery } from "@/lib/ai/voice/voice-settings";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE TEXT TO AUDIO WORKSPACE — its state, and nothing else's
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A standalone tool: text in, audio out. No video is read, no upload is made,
 * no other tool's state is touched — which is also why this hook is small
 * enough to keep the page responsive (the owner's rule: "the AI features
 * should never break the performance, page navigation or button
 * responsiveness"). The estimate is debounced and abortable; Generate is one
 * request; the result is watched by the same poll every other tool uses.
 */
export type TtaLaunch = { phase: "idle" } | { phase: "generating" } | { phase: "error"; code: string; message: string; extra?: Record<string, unknown> };

export function useTextToAudio(opts: { initialJobId?: string | null; initialVoiceId?: string | null }) {
  const [config, setConfig] = useState<TtaConfigAnswer | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [voiceId, setVoiceId] = useState<string | null>(opts.initialVoiceId ?? null);
  const [languageCode, setLanguageCode] = useState<string | null>(null);
  /*
    2026-09-27: the delivery. Null until the config says which one starts
    selected — the operator's default, not this file's opinion. The price does
    not depend on it, so it is deliberately NOT in the quote's dependencies:
    changing the delivery must not re-price and must not clear the estimate.
  */
  const [delivery, setDelivery] = useState<TtsDelivery | null>(null);
  const [funding, setFunding] = useState<"credits" | "wallet" | null>(null);
  const [quote, setQuote] = useState<{ status: "idle" } | { status: "pending" } | { status: "quoted"; answer: TtaQuoteAnswer } | { status: "error"; code: string; message: string }>({ status: "idle" });
  const [launch, setLaunch] = useState<TtaLaunch>({ phase: "idle" });
  const [jobId, setJobId] = useState<string | null>(opts.initialJobId ?? null);
  const requestId = useRef<string | null>(null);
  const quoteAbort = useRef<AbortController | null>(null);
  const watch = useJobWatch(jobId);

  const loadConfig = useCallback(async () => {
    const res = await getTextToAudioConfig();
    if (res.ok) {
      setConfig(res);
      setConfigError(null);
      setVoiceId((v) => v ?? res.config.voices[0]?.id ?? null);
      setDelivery((d) => d ?? res.config.defaultDelivery ?? "natural");
      setLanguageCode((l) => l ?? res.config.voices[0]?.languages[0] ?? res.config.languages[0]?.code ?? null);
    } else setConfigError(res.error);
  }, []);
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const characters = text.trim().length;
  const maximum = config?.config.maximumCharacters ?? 5000;
  const minimum = config?.config.minimumCharacters ?? 1;
  const overLimit = characters > maximum;
  const ready = characters >= minimum && !overLimit;

  /* the estimate: debounced, abortable, server-priced */
  useEffect(() => {
    if (!ready || !config?.config.enabled) {
      setQuote({ status: "idle" });
      return;
    }
    quoteAbort.current?.abort();
    const controller = new AbortController();
    quoteAbort.current = controller;
    setQuote({ status: "pending" });
    const timer = window.setTimeout(async () => {
      const res = await getTextToAudioQuote({ characters }, controller.signal);
      if (controller.signal.aborted) return;
      if (res.ok) setQuote({ status: "quoted", answer: res });
      else setQuote({ status: "error", code: res.code, message: res.error });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [ready, characters, config?.config.enabled]);

  const generate = useCallback(async () => {
    if (!ready || quote.status !== "quoted") return;
    setLaunch({ phase: "generating" });
    track("text_to_audio_generate_clicked", { characters });
    if (!requestId.current) requestId.current = newClientRequestId();
    const res = await generateTextToAudio({
      clientRequestId: requestId.current,
      text: text.trim(),
      ...(name.trim() ? { name: name.trim() } : {}),
      voiceId,
      languageCode,
      ...(config?.config.deliveryChoice && delivery ? { delivery } : {}),
      quote: { totalCents: quote.answer.quote.totalCents, pricingConfigVersion: quote.answer.quote.pricingConfigVersion },
      ...(funding ? { funding } : {}),
    });
    if (!res.ok) {
      setLaunch({ phase: "error", code: res.code, message: res.error, extra: res.extra });
      // a moved price or a changed allowance: price it again before the next press
      if (res.code === "PRICE_CHANGED" || res.code === "CR_CREDITS_UNAVAILABLE") setQuote({ status: "idle" });
      // the server names the voice to choose when none was set
      if (res.code === "INVALID_INPUT" && typeof res.extra?.suggestedVoiceId === "string") setVoiceId(res.extra.suggestedVoiceId);
      return;
    }
    requestId.current = null;
    setLaunch({ phase: "idle" });
    setJobId(res.job.id);
  }, [ready, quote, text, name, voiceId, languageCode, delivery, config?.config.deliveryChoice, funding, characters]);

  const reset = useCallback(() => {
    setJobId(null);
    setLaunch({ phase: "idle" });
    requestId.current = null;
    setQuote({ status: "idle" });
    setFunding(null);
    void loadConfig();
  }, [loadConfig]);

  const clearLaunchError = useCallback(() => setLaunch((l) => (l.phase === "error" ? { phase: "idle" } : l)), []);

  return {
    config,
    configError,
    reloadConfig: loadConfig,
    text,
    setText,
    name,
    setName,
    voiceId,
    setVoiceId,
    languageCode,
    setLanguageCode,
    delivery,
    setDelivery,
    characters,
    maximum,
    minimum,
    overLimit,
    ready,
    quote,
    funding,
    setFunding,
    launch,
    clearLaunchError,
    generate,
    jobId,
    watch,
    reset,
  };
}
