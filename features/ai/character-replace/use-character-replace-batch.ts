"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readVideoMetadata } from "@/features/ai/character-replace/read-media";
import type { useCharacterReplaceWorkspace } from "@/features/ai/character-replace/use-character-replace-workspace";
import {
  createCharacterReplaceBatch,
  getCharacterReplaceQuote,
  preflightCharacterReplaceJob,
  startCharacterReplaceBatch,
  type StartQuoteFields,
  type StartVoiceFields,
} from "@/lib/ai/character-replace/client";
import type { QuoteInput } from "@/lib/ai/character-replace/pricing";
import type { CharacterReplacePreflight, PricingSnapshot, SourceVideo } from "@/lib/ai/character-replace/types";
import { characterReplaceLimits, validateVideoFile, validateVideoMetadata } from "@/lib/ai/character-replace/validate";
import { dialogueCharacters } from "@/lib/ai/character-replace/workspace";
import { newClientRequestId, uploadSource } from "@/lib/ai/client";
import type { AiMediaErrorCode } from "@/lib/ai/media";
import { track } from "@/lib/analytics/client";
import { haptic } from "@/lib/motion/haptics";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE MULTI-VIDEO SESSION — side effects beside the single-video hook (0166)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: several videos, one photo, the same settings; a
 * "Process N videos" button; per-video truthful states; nothing processed
 * merely because it was selected.
 *
 * Composes WITH `useCharacterReplaceWorkspace` rather than replacing it: the
 * first video stays the workspace's own (every step, rule and price built
 * for one video keeps working); the 2nd … Nth ride in `project.extraVideos`
 * and this hook owns what is different about them —
 *
 *   · picking several files at once (each measured by the browser, each
 *     refused on its own if it breaks a rule; a longer-than-allowed video
 *     is refused here because a batch has no trim);
 *   · a signed quote PER VIDEO — the price is per second, so N videos are N
 *     quotes (parallel, cheap, re-asked when the shared settings change);
 *   · the launch: one batch create, N uploads, N media checks, one start —
 *     each phase per video, with the only measured progress there is (the
 *     upload's own bytes).
 *
 * Nothing here prices, charges or submits; every figure the member sees
 * before Start is the server's, and every decision that spends is /start's.
 */

export type BatchItemPhase = "pending" | "uploading" | "checking" | "ready" | "attention" | "error";

export interface BatchLaunchItem {
  index: number;
  name: string;
  size: number;
  jobId: string | null;
  phase: BatchItemPhase;
  /** The upload's own bytes, 0–1 — the one measured progress. */
  uploadProgress: number;
  preflight: CharacterReplacePreflight | null;
  token: string | null;
  message: string | null;
}

export type BatchLaunchState =
  | { phase: "idle" }
  | { phase: "creating"; total: number }
  | { phase: "uploading"; batchId: string; items: BatchLaunchItem[] }
  | { phase: "checking"; batchId: string; items: BatchLaunchItem[] }
  /** Every video passed (or the member dropped the ones that did not): the summary and the confirm. */
  | { phase: "ready"; batchId: string; items: BatchLaunchItem[] }
  /** At least one video did not pass its check — the words per video, and what can be done. */
  | { phase: "attention"; batchId: string; items: BatchLaunchItem[] }
  | { phase: "starting"; batchId: string; items: BatchLaunchItem[] }
  | { phase: "error"; code: string; message: string; batchId?: string };

export interface ExtraQuote {
  key: string;
  status: "pending" | "quoted" | "error";
  snapshot: PricingSnapshot | null;
}

const keyOf = (v: Pick<SourceVideo, "name" | "size">) => `${v.name}|${v.size}`;

export function useCharacterReplaceBatch(ws: ReturnType<typeof useCharacterReplaceWorkspace>) {
  const { state, loads, send } = ws;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* ── object URLs for the extras: minted here, revoked when a video leaves ── */
  const urls = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const live = new Set(state.project.extraVideos.map(keyOf));
    if (state.project.video) live.add(keyOf(state.project.video));
    for (const [key, url] of urls.current) {
      if (!live.has(key)) {
        URL.revokeObjectURL(url);
        urls.current.delete(key);
      }
    }
  }, [state.project.extraVideos, state.project.video]);
  useEffect(() => {
    const held = urls.current;
    return () => {
      for (const url of held.values()) URL.revokeObjectURL(url);
      held.clear();
    };
  }, []);

  const limits = characterReplaceLimits(loads.config, state.project.mode);
  const maxVideos = loads.config?.batch?.maxVideos ?? 1;
  const queueEnabled = loads.config?.batch?.queueEnabled ?? false;
  const canAdd = loads.balance?.processing?.canAdd ?? null;
  const multiAllowed = queueEnabled && maxVideos > 1;
  const count = (state.project.video ? 1 : 0) + state.project.extraVideos.length;

  /* ── picking several ───────────────────────────────────────────────────── */
  const [pickErrors, setPickErrors] = useState<{ name: string; code: AiMediaErrorCode | "too-many" | "video-too-long" }[]>([]);

  const pickVideos = useCallback(
    async (files: readonly File[]) => {
      const errors: { name: string; code: AiMediaErrorCode | "too-many" | "video-too-long" }[] = [];
      const room = Math.max(0, (multiAllowed ? maxVideos : 1) - count);
      const accepted = files.slice(0, room);
      for (const f of files.slice(room)) errors.push({ name: f.name, code: "too-many" });
      const measured: SourceVideo[] = [];
      for (const file of accepted) {
        const verdict = validateVideoFile(file, limits);
        if (!verdict.ok) {
          errors.push({ name: file.name, code: verdict.code });
          continue;
        }
        const key = keyOf(file);
        const objectUrl = urls.current.get(key) ?? URL.createObjectURL(file);
        urls.current.set(key, objectUrl);
        const metadata = await readVideoMetadata(objectUrl, file);
        if (!alive.current) return;
        if (metadata === "invalid") {
          errors.push({ name: file.name, code: "invalid-video" });
          continue;
        }
        const facts = validateVideoMetadata(metadata, limits);
        if (!facts.ok) {
          errors.push({ name: file.name, code: facts.code });
          continue;
        }
        measured.push({ file, objectUrl, name: file.name, size: file.size, mimeType: file.type, metadata });
      }
      /*
        The FIRST video may be longer than the ceiling (the settings step
        trims it); a batch has no trim, so once there is more than one video
        every one must fit as it is. Refused here with its own words rather
        than accepted into a session that cannot start.
      */
      const willBeBatch = count + measured.length > 1;
      const fitting = measured.filter((v) => {
        const ok = !willBeBatch || v.metadata.durationMs === null || v.metadata.durationMs <= limits.video.maxDurationMs + 50;
        if (!ok) errors.push({ name: v.name, code: "video-too-long" });
        return ok;
      });
      if (willBeBatch && state.project.video && state.project.video.metadata.durationMs !== null && state.project.video.metadata.durationMs > limits.video.maxDurationMs + 50) {
        // The video already picked was relying on the trim — it cannot lead a batch.
        errors.push({ name: state.project.video.name, code: "video-too-long" });
        setPickErrors(errors);
        haptic("medium");
        return;
      }
      if (fitting.length) {
        haptic("light");
        send({ type: "videos/add", videos: fitting });
        track("character_replace_videos_added", { added: fitting.length, total: count + fitting.length, mode: state.project.mode });
      } else if (errors.length) {
        haptic("medium");
      }
      setPickErrors(errors);
    },
    [count, limits, maxVideos, multiAllowed, send, state.project.mode, state.project.video],
  );

  const removeExtra = useCallback((index: number) => send({ type: "videos/remove", index }), [send]);
  const clearAll = useCallback(() => {
    setPickErrors([]);
    send({ type: "videos/clear" });
  }, [send]);
  const clearPickErrors = useCallback(() => setPickErrors([]), []);

  /* ── a quote per extra video ─────────────────────────────────────────── */
  const primary = state.pricing.status === "quoted" ? state.pricing.snapshot : null;
  const newVoice = state.project.voice.mode === "new_voice";
  const voiceSource = newVoice ? state.project.voice.source : null;
  const ttsCharacters = newVoice && voiceSource === "tts" ? dialogueCharacters(state.project.voice.text) : 0;
  const voiceChange = newVoice && voiceSource === "upload" && state.project.voice.changeVoice;
  const base = useMemo<Omit<QuoteInput, "selectedDurationMs"> | null>(() => {
    if (!primary) return null;
    return { mode: state.project.mode, quality: state.project.settings.quality, voiceMode: state.project.voice.mode, voiceSource, ttsCharacters, voiceChange, lipSyncMode: newVoice ? state.project.lipSync.tier : null };
  }, [newVoice, primary, state.project.lipSync.tier, state.project.mode, state.project.settings.quality, state.project.voice.mode, ttsCharacters, voiceChange, voiceSource]);
  const baseSig = useMemo(() => (base && primary ? JSON.stringify({ ...base, v: primary.pricingConfigVersion, id: primary.id }) : null), [base, primary]);
  const [extraQuotes, setExtraQuotes] = useState<Record<string, ExtraQuote & { sig: string }>>({});

  useEffect(() => {
    if (!base || !baseSig || state.project.extraVideos.length === 0) return;
    const controller = new AbortController();
    const wanted = state.project.extraVideos.filter((v) => v.metadata.durationMs !== null && extraQuotes[keyOf(v)]?.sig !== baseSig);
    if (!wanted.length) return;
    setExtraQuotes((q) => {
      const next = { ...q };
      for (const v of wanted) next[keyOf(v)] = { key: keyOf(v), status: "pending", snapshot: null, sig: baseSig };
      return next;
    });
    void Promise.all(
      wanted.map(async (v) => {
        const res = await getCharacterReplaceQuote({ ...base, selectedDurationMs: Math.round(v.metadata.durationMs ?? 0) }, controller.signal);
        if (!alive.current || controller.signal.aborted) return;
        setExtraQuotes((q) => ({ ...q, [keyOf(v)]: { key: keyOf(v), status: res.ok ? "quoted" : "error", snapshot: res.ok ? { ...res.quote, billing: res.billing ?? null, credits: res.credits ?? null, walletOffered: res.walletOffered !== false } : null, sig: baseSig } }));
      }),
    );
    return () => controller.abort();
    // `extraQuotes` is read, not a trigger: a newly quoted video must not re-run the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, baseSig, state.project.extraVideos]);

  /** The whole session's price: the first video's signed quote plus every extra's. Null until all are in. */
  const pricing = useMemo(() => {
    if (!primary) return null;
    const extras = state.project.extraVideos.map((v) => extraQuotes[keyOf(v)] ?? null);
    const complete = extras.every((q) => q && q.status === "quoted" && q.snapshot);
    const failed = extras.some((q) => q && q.status === "error");
    const totalCents = primary.totalCents + extras.reduce((sum, q) => sum + (q?.snapshot?.totalCents ?? 0), 0);
    const complimentaryCount = (primary.billing?.complimentary ? 1 : 0) + extras.filter((q) => q?.snapshot?.billing?.complimentary).length;
    return { complete, failed, totalCents, currency: primary.currency, count: 1 + extras.length, complimentaryCount, quotes: [primary, ...extras.map((q) => q?.snapshot ?? null)] };
  }, [extraQuotes, primary, state.project.extraVideos]);

  /* ── the launch ──────────────────────────────────────────────────────── */
  const [launch, setLaunch] = useState<BatchLaunchState>({ phase: "idle" });
  const batchRequestId = useRef<string | null>(null);

  const voiceBody = useCallback((): StartVoiceFields | undefined => {
    const voice = state.project.voice;
    if (voice.mode !== "new_voice" || !voice.source) return undefined;
    return voice.source === "upload"
      ? { source: "upload", trimToFit: voice.trimAudioToFit, voiceConsent: voice.voiceConsent, ...(voice.changeVoice && voice.changeVoiceId ? { changeVoiceId: voice.changeVoiceId } : {}) }
      : { source: "tts", text: voice.text.trim(), languageCode: voice.languageCode ?? undefined, voiceId: voice.voiceId ?? undefined, trimToFit: voice.trimAudioToFit, voiceConsent: voice.voiceConsent };
  }, [state.project.voice]);

  const quoteFields = (q: PricingSnapshot): StartQuoteFields => ({
    id: q.id,
    product: "character_replace",
    currency: q.currency,
    pricingConfigVersion: q.pricingConfigVersion,
    durationMs: q.durationMs,
    mode: q.mode,
    quality: q.quality,
    voiceMode: q.voiceMode,
    voiceSource: q.voiceSource,
    ttsCharacters: q.ttsCharacters,
    voiceChange: q.voiceChange === true,
    lipSyncMode: q.lipSyncMode,
    totalCents: q.totalCents,
    expiresAt: q.expiresAt,
  });

  /**
   * "Process N videos": open the batch, upload every file, check every video.
   * Ends in `ready` (every video passed) or `attention` (some did not) — and
   * nothing has been charged either way. The confirm below is the spend.
   */
  const startBatch = useCallback(async (): Promise<void> => {
    const photo = state.project.character;
    const videos = state.project.video ? [state.project.video, ...state.project.extraVideos] : [];
    if (!photo || videos.length < 2 || !state.project.consent || !pricing?.complete) return;
    if (!photo.width || !photo.height) {
      setLaunch({ phase: "error", code: "INVALID_INPUT", message: "We couldn't read the size of your photo. Choose it again." });
      return;
    }
    const references = state.project.mode === "skin_face" ? state.project.references : [];
    const voice = state.project.voice;
    const uploadVoice = voice.mode === "new_voice" && voice.source === "upload" ? voice.audio : null;
    for (const v of videos) {
      if (!v.metadata.width || !v.metadata.height || !v.metadata.durationMs) {
        setLaunch({ phase: "error", code: "INVALID_INPUT", message: `We couldn't read ${v.name}. Choose it again.` });
        return;
      }
    }
    batchRequestId.current ??= newClientRequestId();
    setLaunch({ phase: "creating", total: videos.length });
    track("character_replace_batch_started", { videos: videos.length, mode: state.project.mode });
    const created = await createCharacterReplaceBatch({
      batchRequestId: batchRequestId.current,
      mode: state.project.mode,
      photo: { name: photo.name, mimeType: photo.mimeType, size: photo.size, width: photo.width, height: photo.height },
      ...(references.length ? { references: references.map((r) => ({ name: r.name, mimeType: r.mimeType, size: r.size, width: r.width!, height: r.height! })) } : {}),
      ...(uploadVoice ? { audio: { name: uploadVoice.name, mimeType: uploadVoice.mimeType, size: uploadVoice.size, durationMs: uploadVoice.durationMs } } : {}),
      videos: videos.map((v) => ({ name: v.name, mimeType: v.mimeType, size: v.size, durationMs: Math.round(v.metadata.durationMs!), width: v.metadata.width!, height: v.metadata.height!, hasAudio: v.metadata.hasAudio === true })),
    });
    if (!alive.current) return;
    if (!created.ok) {
      setLaunch({ phase: "error", code: created.code, message: created.error });
      return;
    }
    const batchId = created.batchId;
    let items: BatchLaunchItem[] = videos.map((v, i) => ({ index: i, name: v.name, size: v.size, jobId: created.jobs[i]?.job.id ?? null, phase: "pending", uploadProgress: 0, preflight: null, token: null, message: null }));
    const patch = (i: number, p: Partial<BatchLaunchItem>) => {
      items = items.map((it) => (it.index === i ? { ...it, ...p } : it));
    };
    const show = (phase: "uploading" | "checking") => {
      if (alive.current) setLaunch({ phase, batchId, items });
    };

    /* the uploads — one job at a time; the photo (and voice) first, the video carries the bar */
    show("uploading");
    for (const [i, v] of videos.entries()) {
      const opened = created.jobs[i];
      if (!opened) {
        patch(i, { phase: "error", message: "This video wasn't opened. Remove it and try again." });
        continue;
      }
      patch(i, { phase: "uploading" });
      show("uploading");
      const photoOk = await uploadSource({ ticket: opened.uploads.photo, file: photo.file });
      if (!alive.current) return;
      let ok = photoOk;
      if (ok) {
        for (const [ri, r] of references.entries()) {
          const ticket = opened.uploads.references[ri];
          if (!ticket) continue;
          ok = await uploadSource({ ticket, file: r.file });
          if (!alive.current) return;
          if (!ok) break;
        }
      }
      if (ok && uploadVoice && opened.uploads.voice) {
        ok = await uploadSource({ ticket: opened.uploads.voice, file: uploadVoice.file });
        if (!alive.current) return;
      }
      if (ok) {
        ok = await uploadSource({
          ticket: opened.uploads.video,
          file: v.file,
          onProgress: (fraction) => {
            patch(i, { uploadProgress: Math.max(0, Math.min(1, fraction)) });
            show("uploading");
          },
        });
        if (!alive.current) return;
      }
      patch(i, ok ? { phase: "checking", uploadProgress: 1 } : { phase: "error", message: "Didn't upload. Check your connection and try again." });
      show("uploading");
    }

    /* the media checks — nothing is charged by these */
    show("checking");
    for (const it of items) {
      if (it.phase !== "checking" || !it.jobId) continue;
      const checked = await preflightCharacterReplaceJob(it.jobId);
      if (!alive.current) return;
      if (!checked.ok) patch(it.index, { phase: "error", message: checked.error });
      else if (checked.preflight.valid && checked.token) patch(it.index, { phase: "ready", preflight: checked.preflight, token: checked.token });
      else patch(it.index, { phase: "attention", preflight: checked.preflight, message: checked.preflight.headline?.title ?? checked.preflight.issues[0]?.title ?? "Needs attention" });
      show("checking");
    }
    const allReady = items.every((it) => it.phase === "ready");
    haptic(allReady ? "selection" : "medium");
    setLaunch({ phase: allReady ? "ready" : "attention", batchId, items });
  }, [pricing, state.project]);

  /**
   * The confirm: the spend. Only the videos that passed are started — each
   * with its own signed quote and its own token — and the server decides
   * per video what is complimentary, what is paid, what waits.
   */
  const confirmBatch = useCallback(async (): Promise<{ batchId: string } | null> => {
    if (launch.phase !== "ready" && launch.phase !== "attention") return null;
    if (!pricing?.complete) return null;
    const passing = launch.items.filter((it) => it.phase === "ready" && it.jobId && it.token);
    if (!passing.length) return null;
    const { batchId } = launch;
    setLaunch({ phase: "starting", batchId, items: launch.items });
    const jobs = passing.map((it) => {
      const q = pricing.quotes[it.index];
      return q ? { jobId: it.jobId!, quote: quoteFields(q), preflightToken: it.token!, voice: voiceBody(), ...(ws.funding ? { funding: ws.funding } : {}) } : null;
    });
    if (jobs.some((j) => !j)) {
      setLaunch({ phase: "error", code: "PRICE_CHANGED", message: "The price needs a refresh. Review and try again.", batchId });
      return null;
    }
    const started = await startCharacterReplaceBatch(batchId, { jobs: jobs as NonNullable<(typeof jobs)[number]>[], consent: true });
    if (!alive.current) return null;
    if (!started.ok) {
      if (started.code === "CR_BALANCE_REQUIRED") void ws.reloadBalance();
      setLaunch({ phase: "error", code: started.code, message: started.error, batchId });
      return null;
    }
    const refused = started.results.filter((r) => !r.ok);
    // Any that refused (a price that moved, a check that expired) are left as drafts; the board says so per video.
    if (refused.length && refused.length === started.results.length) {
      const first = refused[0]!;
      setLaunch({ phase: "error", code: first.code ?? "INTERNAL_ERROR", message: first.error ?? "None of the videos could start.", batchId });
      void ws.reloadBalance();
      return null;
    }
    batchRequestId.current = null;
    void ws.reloadBalance();
    track("character_replace_batch_confirmed", { videos: passing.length, started: started.results.filter((r) => r.started).length, waiting: started.results.filter((r) => r.waiting).length });
    setLaunch({ phase: "idle" });
    try {
      window.sessionStorage.setItem("frenz:cr:photo-in-hand", "1");
    } catch {
      /* a refused write only hides the shortcut */
    }
    return { batchId };
  }, [launch, pricing, voiceBody, ws]);

  /** From `attention`: drop the videos that did not pass and start the rest. */
  const dropFailedAndConfirm = useCallback(async () => {
    if (launch.phase !== "attention") return null;
    const kept = launch.items.filter((it) => it.phase === "ready");
    if (!kept.length) return null;
    // The dropped videos leave the draft too, so the summary and the price agree with what starts.
    const dropped = launch.items.filter((it) => it.phase !== "ready");
    for (const it of dropped) {
      const extraIndex = state.project.extraVideos.findIndex((v) => v.name === it.name && v.size === it.size);
      if (extraIndex >= 0) send({ type: "videos/remove", index: extraIndex });
    }
    return confirmBatch();
  }, [confirmBatch, launch, send, state.project.extraVideos]);

  const cancelLaunch = useCallback(() => {
    // The drafts left behind are superseded by the next create and expired by the sweep — nothing was charged.
    batchRequestId.current = null;
    setLaunch({ phase: "idle" });
  }, []);
  const clearLaunchError = useCallback(() => setLaunch((l) => (l.phase === "error" ? { phase: "idle" } : l)), []);

  return {
    multiAllowed,
    maxVideos,
    canAdd,
    count,
    isBatch: count > 1,
    pickVideos,
    removeExtra,
    clearAll,
    pickErrors,
    clearPickErrors,
    extraQuotes,
    pricing,
    launch,
    startBatch,
    confirmBatch,
    dropFailedAndConfirm,
    cancelLaunch,
    clearLaunchError,
  };
}
