"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  createCharacterReplaceJob,
  getCharacterReplaceBalance,
  getCharacterReplaceConfig,
  getCharacterReplaceQuote,
  readCachedCharacterReplaceBalance,
  startCharacterReplaceJob,
  takeTopupReturnReference,
  verifyCharacterReplaceTopup,
} from "@/lib/ai/character-replace/client";
import { newClientRequestId, uploadSource } from "@/lib/ai/client";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceAnyQuality, QuoteInput } from "@/lib/ai/character-replace/pricing";
import type { CharacterReplaceBalance } from "@/lib/ai/character-replace/types";
import { validateAudioFile } from "@/lib/ai/voice/audio-validate";
import {
  characterReplaceLimits,
  inputReadiness,
  selectedRangeMs,
  validatePhotoFile,
  validatePhotoPixels,
  validateVideoFile,
  validateVideoMetadata,
} from "@/lib/ai/character-replace/validate";
import {
  dialogueCharacters,
  INITIAL_STATE,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from "@/lib/ai/character-replace/workspace";
import { readAudioDuration, readImageSize, readVideoMetadata } from "@/features/ai/character-replace/read-media";
import { haptic } from "@/lib/motion/haptics";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WORKSPACE HOOK — side effects around a pure reducer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owns: the reads from the server (config, balance, and since Part 3 the
 * quote), the decoding of a picked file for its facts, the object URLs and
 * their revocation, and the Paystack return. Decides nothing about the draft
 * itself — that is the reducer's, and it is tested without a browser.
 *
 * ── 🔴 THE PRICE IS ASKED FOR ON EVERY CHANGE, AND NEVER COMPUTED HERE ───────
 *
 * Owner, 2026-09-13 (Part 3, §12): "The price should update when the user
 * changes: trim duration, output quality, voice mode, lip-sync mode." The
 * reducer marks the quote `stale` on each of those; the effect below sees
 * `stale` (or `idle` with complete inputs) and asks the server again, a beat
 * after the last change so a dragged trim handle sends one request rather
 * than sixty. A newer request aborts the older; an answer that is not the
 * newest is dropped; a quote that reaches its `expiresAt` is marked stale so
 * a member who lingers on the review step never confirms a price the server
 * would no longer honour.
 *
 * ── 🔴 NOTHING LEAVES THE DEVICE ─────────────────────────────────────────────
 *
 * Part 1, §6 and Part 2, §25: nothing is uploaded, previewed by a server, or
 * hashed. A picked file is decoded ONCE by the browser's own `<img>` /
 * `<video>` (features/ai/character-replace/read-media.ts) for its facts, and
 * held as an object URL for the preview. Replacing or removing a file revokes
 * its URL immediately; closing the page revokes whatever is left.
 */

/** The browser's own phases before the server has a row — the only measured progress there is. */
export type LaunchState =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "uploading"; progress: number }
  | { phase: "starting" }
  | { phase: "error"; code: string; message: string };

export interface WorkspaceLoads {
  config: CharacterReplacePublicConfig | null;
  /** The tool is on for this member. Null until the config answers. */
  available: boolean | null;
  /** A job can actually run on this deployment (provider + worker + the operator's switches). Null until the config answers. */
  processingAvailable: boolean | null;
  /** Part 8 §2, §30: why Start is off, in the operator's own words — maintenance, or a pause. */
  processingNotice: string | null;
  configError: string | null;
  balance: CharacterReplaceBalance | null;
  balanceError: string | null;
  /** What a finished recharge said, for the balance card to show once. */
  topupNotice: string | null;
}

export function useCharacterReplaceWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, INITIAL_STATE);
  const [loads, setLoads] = useState<WorkspaceLoads>({
    config: null,
    available: null,
    processingAvailable: null,
    processingNotice: null,
    configError: null,
    // The last figure this browser saw paints first (from the effect below,
    // not here — the prerendered markup has no balance); the network replaces it.
    balance: null,
    balanceError: null,
    topupNotice: null,
  });

  const alive = useRef(true);
  /*
    Every object URL this hook has minted and not yet revoked. A ref, because
    the unmount cleanup below runs with the render it closed over, and a URL
    created after that render would otherwise leak.
  */
  const urls = useRef<Set<string>>(new Set());
  const mint = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    return url;
  }, []);
  /*
    🔴 REVOKED AFTER REACT HAS LET GO OF IT. A player that still references
    the URL when it is revoked logs a network error (`ERR_FILE_NOT_FOUND`)
    and, on some engines, blanks — the Playwright walk caught exactly that on
    a replace. The state change that unmounts the element is dispatched
    first; the revocation waits a second, by which time the commit has
    happened AND any metadata fetch the outgoing player had in flight has
    settled (a replace within a beat of a mount still raced a zero-delay
    revoke in the walk). A blob URL held one second longer costs nothing;
    the unmount cleanup below still revokes everything at once.
  */
  const release = useCallback((url: string | null | undefined) => {
    if (!url || !urls.current.has(url)) return;
    urls.current.delete(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  useEffect(() => {
    alive.current = true;
    // The Set itself is stable for the life of the hook; capturing it here is
    // what the lint rule asks for, and it is the same object either way.
    const minted = urls.current;
    return () => {
      alive.current = false;
      for (const url of minted) URL.revokeObjectURL(url);
      minted.clear();
    };
  }, []);

  /* ───────────────────────── the two reads ─────────────────────────────── */

  const loadBalance = useCallback(async () => {
    const res = await getCharacterReplaceBalance();
    if (!alive.current) return;
    if (res.ok) setLoads((l) => ({ ...l, balance: res.balance, balanceError: null }));
    else setLoads((l) => ({ ...l, balanceError: res.error }));
  }, []);

  useEffect(() => {
    const cached = readCachedCharacterReplaceBalance();
    if (cached) setLoads((l) => (l.balance ? l : { ...l, balance: cached }));
    void (async () => {
      const res = await getCharacterReplaceConfig();
      if (!alive.current) return;
      if (res.ok)
        setLoads((l) => ({
          ...l,
          config: res.config,
          available: res.available,
          processingAvailable: res.processingAvailable === true,
          processingNotice: res.maintenance?.active
            ? (res.maintenance.message ?? "Character Replace is being looked after right now. New videos will be back shortly.")
            : res.processingPaused
              ? "New videos are paused for a moment while we look after the service. Nothing has been charged — try again shortly."
              : null,
          configError: null,
        }));
      else setLoads((l) => ({ ...l, configError: res.error, available: false }));
    })();

    /*
      The return from Paystack, if this is one. The reference is taken out of
      the address bar before anything else runs, verified once, and the wallet
      re-read — the same contract the dashboard keeps, so a recharge started
      from this workspace finishes on this workspace.
    */
    const reference = takeTopupReturnReference();
    void (async () => {
      if (reference) {
        const verified = await verifyCharacterReplaceTopup(reference);
        if (!alive.current) return;
        setLoads((l) => ({
          ...l,
          topupNotice: verified.ok
            ? verified.credited
              ? "Payment received — your balance has been updated."
              : verified.pending
                ? "Your payment is still being confirmed. This will update shortly."
                : null
            : null,
        }));
      }
      await loadBalance();
    })();
  }, [loadBalance]);

  /* ───────────────────────── the quote (Part 3) ────────────────────────── */

  /*
    The four priced inputs, as one object that is referentially stable while
    none of them changes — so the effect below runs on a REAL change and not
    on every render of the workspace.
  */
  const range = selectedRangeMs(state.project);
  const newVoice = state.project.voice.mode === "new_voice";
  const voiceSource = newVoice ? state.project.voice.source : null;
  const ttsCharacters = newVoice && voiceSource === "tts" ? dialogueCharacters(state.project.voice.text) : 0;
  const quoteInput = useMemo<QuoteInput | null>(() => {
    if (!range) return null;
    const ms = range.endMs - range.startMs;
    if (ms <= 0) return null;
    // A new voice with no source yet, or a dialogue still empty, is not priceable — the price waits for the choice.
    if (newVoice && (!voiceSource || (voiceSource === "tts" && ttsCharacters === 0))) return null;
    return {
      selectedDurationMs: ms,
      mode: state.project.mode,
      quality: state.project.settings.quality,
      voiceMode: state.project.voice.mode,
      voiceSource,
      ttsCharacters,
      lipSyncMode: newVoice ? state.project.lipSync.tier : null,
    };
    // The range is a fresh object each render; its two numbers are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range?.startMs, range?.endMs, state.project.mode, state.project.settings.quality, state.project.voice.mode, voiceSource, ttsCharacters, state.project.lipSync.tier]);

  const ready = inputReadiness(state.project, loads.config).ready;
  const quotable = ready && loads.available === true && loads.config?.pricingAvailable === true && quoteInput !== null;
  const pricingStatus = state.pricing.status;
  const quoteSeq = useRef(0);
  const quoteAbort = useRef<AbortController | null>(null);
  /** A member pressing "Try again" on a failed quote; bumps to re-run the effect. */
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!quotable || !quoteInput) {
      // Inputs incomplete, or the tool is off: whatever was quoted no longer
      // applies. Back to idle, once (the reducer ignores a no-op).
      if (pricingStatus !== "idle") dispatch({ type: "pricing", pricing: { status: "idle" } });
      return;
    }
    if (pricingStatus === "quoted" || pricingStatus === "error") return;
    // idle with complete inputs, stale after a change, pending after a retry
    const seq = ++quoteSeq.current;
    quoteAbort.current?.abort();
    const controller = new AbortController();
    quoteAbort.current = controller;
    const timer = window.setTimeout(async () => {
      const res = await getCharacterReplaceQuote(quoteInput, controller.signal);
      if (!alive.current || seq !== quoteSeq.current || controller.signal.aborted) return;
      if (res.ok) {
        dispatch({ type: "pricing", pricing: { status: "quoted", snapshot: res.quote } });
        // The server read the wallet while quoting; the card shows the same figure.
        setLoads((l) => (l.balance && l.balance.balanceCents !== res.balanceCents ? { ...l, balance: { ...l.balance, balanceCents: res.balanceCents } } : l));
      } else {
        dispatch({ type: "pricing", pricing: { status: "error", message: res.code === "NETWORK" ? res.error : "We couldn't price this. Try again." } });
      }
    }, pricingStatus === "stale" ? 350 : 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `retry` is a deliberate re-run trigger with no value of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotable, quoteInput, pricingStatus, retry]);

  /* A quote past its time is stale: the effect above asks again. */
  useEffect(() => {
    if (state.pricing.status !== "quoted") return;
    const snapshot = state.pricing.snapshot;
    const wait = Math.max(0, new Date(snapshot.expiresAt).getTime() - Date.now());
    if (!Number.isFinite(wait)) return;
    const timer = window.setTimeout(() => dispatch({ type: "pricing", pricing: { status: "stale", snapshot } }), wait);
    return () => window.clearTimeout(timer);
  }, [state.pricing]);

  const requote = useCallback(() => {
    dispatch({ type: "pricing", pricing: { status: "pending" } });
    setRetry((n) => n + 1);
  }, []);

  /* ───────────────────────── the pickers ───────────────────────────────── */

  /*
    Every rule comes from ONE limits object derived from the server's config
    (lib/ai/character-replace/validate.ts). The platform defaults apply until
    the config answers; the server re-checks everything either way.
  */
  const limits = characterReplaceLimits(loads.config, state.project.mode);

  const pickPhoto = useCallback(
    async (file: File) => {
      // The old photo goes first — state, then its URL — so a replace never
      // holds two decoded images and never revokes one still on screen.
      const previous = state.project.character?.objectUrl;
      const verdict = validatePhotoFile(file, limits);
      if (!verdict.ok) {
        haptic("medium");
        dispatch({ type: "photo/invalid", code: verdict.code });
        release(previous);
        return;
      }
      dispatch({ type: "photo/validating" });
      release(previous);
      const objectUrl = mint(file);
      const size = await readImageSize(objectUrl);
      if (!alive.current) return;
      const pixels = validatePhotoPixels(size, limits);
      if (!pixels.ok || !size) {
        release(objectUrl);
        dispatch({ type: pixels.ok ? "photo/error" : pixels.code === "invalid-image" ? "photo/error" : "photo/invalid", code: pixels.ok ? "invalid-image" : pixels.code });
        return;
      }
      haptic("light");
      dispatch({
        type: "photo/ready",
        asset: { file, objectUrl, width: size.width, height: size.height, size: file.size, mimeType: file.type, name: file.name },
      });
    },
    [limits, mint, release, state.project.character?.objectUrl],
  );

  const clearPhoto = useCallback(() => {
    const previous = state.project.character?.objectUrl;
    dispatch({ type: "photo/clear" });
    release(previous);
  }, [release, state.project.character?.objectUrl]);

  /* ── Part 6: the mode, extra references, the replacement audio ────────── */

  const setMode = useCallback(
    (mode: ReplacementMode) => {
      const m = loads.config?.modes.find((x) => x.id === mode);
      // Extra references beyond the new mode's maximum are released by the reducer's trim; their URLs go here.
      const keep = Math.max(0, (m?.maximumReferenceImages ?? 1) - 1);
      for (const r of state.project.references.slice(keep)) release(r.objectUrl);
      dispatch({ type: "mode", mode, defaultQuality: (m?.defaultTier as CharacterReplaceAnyQuality | null | undefined) ?? null, maxReferences: m?.maximumReferenceImages ?? 1 });
    },
    [loads.config?.modes, release, state.project.references],
  );

  const addReference = useCallback(
    async (file: File) => {
      const max = limits.references.max;
      if (state.project.references.length >= Math.max(0, max - 1)) return;
      const verdict = validatePhotoFile(file, limits);
      if (!verdict.ok) return;
      const objectUrl = mint(file);
      const size = await readImageSize(objectUrl);
      if (!alive.current) return;
      const pixels = validatePhotoPixels(size, limits);
      if (!pixels.ok || !size) {
        release(objectUrl);
        return;
      }
      dispatch({ type: "reference/add", asset: { file, objectUrl, width: size.width, height: size.height, size: file.size, mimeType: file.type, name: file.name }, max });
    },
    [limits, mint, release, state.project.references.length],
  );

  const removeReference = useCallback(
    (index: number) => {
      const previous = state.project.references[index]?.objectUrl;
      dispatch({ type: "reference/remove", index });
      release(previous);
    },
    [release, state.project.references],
  );

  const pickAudio = useCallback(
    async (file: File) => {
      const previous = state.project.voice.audio?.objectUrl;
      const verdict = validateAudioFile(file, { maxBytes: loads.config?.audio.maximumUploadBytes ?? 100 * 1024 * 1024 });
      if (!verdict.ok) {
        dispatch({ type: "audio/invalid", code: verdict.code });
        release(previous);
        return;
      }
      dispatch({ type: "audio/validating" });
      release(previous);
      const objectUrl = mint(file);
      /*
        A video from the gallery is read by the video reader (an <audio>
        element refuses a QuickTime container the <video> element plays).

        🔴 The browser's audio detection is NOT a gate (owner, 2026-09-20, on
        an iPhone: "We couldn't read that audio" on a gallery video WITH
        sound). Safari fills `audioTracks` a beat after `loadedmetadata`, so
        at the moment it is read the list is empty and the first cut called
        that "no sound". Only a file the engine cannot open at all is refused
        here; the worker's ffprobe is the authority on whether there is an
        audio track and answers AUDIO_INVALID (nothing charged) when there is
        none.
      */
      const isVideo = file.type.toLowerCase().startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(file.name);
      let duration: number | null | "invalid";
      if (isVideo) {
        const meta = await readVideoMetadata(objectUrl, { name: file.name, size: file.size, type: file.type });
        duration = meta === "invalid" ? "invalid" : meta.durationMs;
      } else {
        duration = await readAudioDuration(objectUrl);
      }
      if (!alive.current) return;
      if (duration === "invalid") {
        release(objectUrl);
        dispatch({ type: "audio/error", code: "invalid-audio" });
        return;
      }
      const maxMs = (loads.config?.audio.maximumDurationSeconds ?? 120) * 1000;
      if (duration !== null && duration > maxMs) {
        release(objectUrl);
        dispatch({ type: "audio/invalid", code: "audio-too-long" });
        return;
      }
      dispatch({ type: "audio/ready", asset: { file, objectUrl, name: file.name, size: file.size, mimeType: file.type, durationMs: duration } });
    },
    [loads.config?.audio.maximumDurationSeconds, loads.config?.audio.maximumUploadBytes, mint, release, state.project.voice.audio?.objectUrl],
  );

  const clearAudio = useCallback(() => {
    const previous = state.project.voice.audio?.objectUrl;
    dispatch({ type: "audio/clear" });
    release(previous);
  }, [release, state.project.voice.audio?.objectUrl]);

  const pickVideo = useCallback(
    async (file: File) => {
      // Replacing: the old preview, metadata and trim all go before the new
      // file is read (§21). The reducer clears the state; the URL it pointed
      // at is revoked once the player is gone.
      const previous = state.project.video?.objectUrl;
      const verdict = validateVideoFile(file, limits);
      if (!verdict.ok) {
        haptic("medium");
        dispatch({ type: "video/invalid", code: verdict.code });
        release(previous);
        return;
      }
      dispatch({ type: "video/validating" });
      release(previous);
      const objectUrl = mint(file);
      const metadata = await readVideoMetadata(objectUrl, file);
      if (!alive.current) return;
      if (metadata === "invalid") {
        release(objectUrl);
        // Not the file's rule-breaking, the decoder's refusal: an `error`,
        // with the "we couldn't read this video" sentence.
        dispatch({ type: "video/error", code: "invalid-video" });
        return;
      }
      const facts = validateVideoMetadata(metadata, limits);
      if (!facts.ok) {
        release(objectUrl);
        haptic("medium");
        dispatch({ type: "video/invalid", code: facts.code });
        return;
      }
      haptic("light");
      dispatch({
        type: "video/ready",
        video: { file, objectUrl, name: file.name, size: file.size, mimeType: file.type, metadata },
        maxDurationMs: limits.video.maxDurationMs,
      });
    },
    [limits, mint, release, state.project.video?.objectUrl],
  );

  const clearVideo = useCallback(() => {
    const previous = state.project.video?.objectUrl;
    dispatch({ type: "video/clear" });
    release(previous);
  }, [release, state.project.video?.objectUrl]);

  const send = useCallback((action: WorkspaceAction) => {
    // A new draft mints a new request id (see `start`).
    if (action.type === "reset" || action.type === "reset/keep-photo") requestId.current = null;
    dispatch(action);
  }, []);

  /* ───────────────────────── Start (Part 4) ────────────────────────────── */

  /*
    The browser's side of steps 7–9: open the job, put both files in the
    private bucket (a PUT straight to storage, with real progress), and hand
    the SIGNED quote back at /start. Nothing here decides a price or moves
    money — the server re-verifies the quote and reserves the charge — and
    the two browser phases (preparing, uploading) are the only "progress"
    that is ever measured; from the server's first row on, the job watch
    owns the screen.

    🔴 ONE clientRequestId PER DRAFT. A retry after a dropped connection
    reuses it, so the server answers with the job it already opened rather
    than a second one; a new draft (reset) mints a new one.
  */
  const requestId = useRef<string | null>(null);
  const [launch, setLaunch] = useState<LaunchState>({ phase: "idle" });
  /*
    Part 5 (§7): the finished attempt a retry is linked to. Set by `retryFrom`,
    sent once with the next /jobs create, then cleared — so a later, unrelated
    draft never inherits an old lineage.
  */
  const retryOf = useRef<string | null>(null);

  const start = useCallback(async (): Promise<string | null> => {
    const photo = state.project.character;
    const video = state.project.video;
    if (!photo || !video || !state.project.consent || state.pricing.status !== "quoted") return null;
    const snapshot = state.pricing.snapshot;
    // Dimensions the browser could not read are refused here rather than sent as zeros; the worker measures the real ones anyway.
    if (!photo.width || !photo.height || !video.metadata.width || !video.metadata.height || !video.metadata.durationMs) {
      setLaunch({ phase: "error", code: "INVALID_INPUT", message: "We couldn't read the size of your files. Choose them again." });
      return null;
    }
    if (launch.phase !== "idle" && launch.phase !== "error") return null;
    requestId.current ??= newClientRequestId();

    const voice = state.project.voice;
    const uploadVoice = voice.mode === "new_voice" && voice.source === "upload" ? voice.audio : null;
    const references = state.project.mode === "skin_face" ? state.project.references : [];
    for (const r of references) {
      if (!r.width || !r.height) {
        setLaunch({ phase: "error", code: "INVALID_INPUT", message: "We couldn't read one of the reference photos. Choose it again." });
        return null;
      }
    }
    setLaunch({ phase: "preparing" });
    const created = await createCharacterReplaceJob({
      clientRequestId: requestId.current,
      ...(retryOf.current ? { retryOf: retryOf.current } : {}),
      mode: state.project.mode,
      photo: { name: photo.name, mimeType: photo.mimeType, size: photo.size, width: photo.width, height: photo.height },
      ...(references.length ? { references: references.map((r) => ({ name: r.name, mimeType: r.mimeType, size: r.size, width: r.width!, height: r.height! })) } : {}),
      video: {
        name: video.name,
        mimeType: video.mimeType,
        size: video.size,
        durationMs: Math.round(video.metadata.durationMs),
        width: video.metadata.width,
        height: video.metadata.height,
        hasAudio: video.metadata.hasAudio === true,
      },
      ...(uploadVoice ? { audio: { name: uploadVoice.name, mimeType: uploadVoice.mimeType, size: uploadVoice.size, durationMs: uploadVoice.durationMs } } : {}),
    });
    if (!alive.current) return null;
    if (!created.ok) {
      setLaunch({ phase: "error", code: created.code, message: created.error });
      return null;
    }
    // The job exists but is past `queued` (a retry after /start already ran): just watch it.
    if (!created.uploads) {
      setLaunch({ phase: "idle" });
      return created.job.id;
    }

    /* the uploads — the photos and the voice are small and first, the video carries the bar */
    setLaunch({ phase: "uploading", progress: 0 });
    const photoOk = await uploadSource({ ticket: created.uploads.photo, file: photo.file });
    if (!alive.current) return null;
    if (!photoOk) {
      setLaunch({ phase: "error", code: "NETWORK", message: "The photo didn't upload. Check your connection and try again." });
      return null;
    }
    for (const [i, r] of references.entries()) {
      const ticket = created.uploads.references[i];
      if (!ticket) continue;
      const ok = await uploadSource({ ticket, file: r.file });
      if (!alive.current) return null;
      if (!ok) {
        setLaunch({ phase: "error", code: "NETWORK", message: `Reference photo ${i + 2} didn't upload. Check your connection and try again.` });
        return null;
      }
    }
    if (uploadVoice && created.uploads.voice) {
      const ok = await uploadSource({ ticket: created.uploads.voice, file: uploadVoice.file });
      if (!alive.current) return null;
      if (!ok) {
        setLaunch({ phase: "error", code: "NETWORK", message: "The audio didn't upload. Check your connection and try again." });
        return null;
      }
    }
    const videoOk = await uploadSource({
      ticket: created.uploads.video,
      file: video.file,
      onProgress: (fraction) => {
        if (alive.current) setLaunch({ phase: "uploading", progress: Math.max(0, Math.min(1, fraction)) });
      },
    });
    if (!alive.current) return null;
    if (!videoOk) {
      setLaunch({ phase: "error", code: "NETWORK", message: "The video didn't upload. Check your connection and try again." });
      return null;
    }

    /* the start — the signed quote, the trim, the consent; the server does the rest */
    setLaunch({ phase: "starting" });
    const range = selectedRangeMs(state.project);
    const sourceMs = Math.round(video.metadata.durationMs);
    const trimmed = !!state.project.settings.trim && range !== null && (range.startMs > 0 || range.endMs < sourceMs);
    const started = await startCharacterReplaceJob(created.job.id, {
      quote: {
        id: snapshot.id,
        product: "character_replace",
        currency: snapshot.currency,
        pricingConfigVersion: snapshot.pricingConfigVersion,
        durationMs: snapshot.durationMs,
        mode: snapshot.mode,
        quality: snapshot.quality,
        voiceMode: snapshot.voiceMode,
        voiceSource: snapshot.voiceSource,
        ttsCharacters: snapshot.ttsCharacters,
        lipSyncMode: snapshot.lipSyncMode,
        totalCents: snapshot.totalCents,
        expiresAt: snapshot.expiresAt,
      },
      trim: trimmed && range ? { startMs: range.startMs, endMs: range.endMs } : null,
      consent: true,
      ...(voice.mode === "new_voice" && voice.source
        ? {
            voice:
              voice.source === "upload"
                ? { source: "upload" as const, trimToFit: voice.trimAudioToFit, voiceConsent: voice.voiceConsent }
                : { source: "tts" as const, text: voice.text.trim(), languageCode: voice.languageCode ?? undefined, voiceId: voice.voiceId ?? undefined, trimToFit: voice.trimAudioToFit, voiceConsent: voice.voiceConsent },
          }
        : {}),
    });
    if (!alive.current) return null;
    if (!started.ok) {
      // A price that moved or expired: fetch the new one and let the member look again.
      if (started.code === "PRICE_CHANGED" || started.code === "QUOTE_EXPIRED") {
        dispatch({ type: "pricing", pricing: { status: "pending" } });
        setRetry((n) => n + 1);
      }
      if (started.code === "CR_BALANCE_REQUIRED") void loadBalance();
      setLaunch({ phase: "error", code: started.code, message: started.error });
      return null;
    }
    requestId.current = null;
    retryOf.current = null;
    void loadBalance();
    setLaunch({ phase: "idle" });
    // Part 7 §16: the photo is still in this browser's hand — the result may offer "Use same photo".
    try {
      window.sessionStorage.setItem("frenz:cr:photo-in-hand", "1");
    } catch {
      /* a refused write only hides the shortcut */
    }
    return started.job.id;
  }, [launch.phase, loadBalance, state.pricing, state.project]);

  /**
   * "Try again" after a failure (§7 / §29): the draft — both files, the
   * settings, the trim — is KEPT; only the price is asked for afresh and the
   * next Start opens attempt n+1 linked to the failed one. A draft that has
   * no files any more (the page was opened from a notification) simply goes
   * back to the first step.
   */
  const retryFrom = useCallback(
    (failedJobId: string) => {
      retryOf.current = failedJobId;
      requestId.current = null;
      setLaunch({ phase: "idle" });
      if (state.project.character && state.project.video) {
        dispatch({ type: "pricing", pricing: { status: "pending" } });
        setRetry((n) => n + 1);
        dispatch({ type: "go", step: "review" });
      } else {
        dispatch({ type: "reset" });
      }
    },
    [state.project.character, state.project.video],
  );

  const clearLaunchError = useCallback(() => setLaunch((l) => (l.phase === "error" ? { phase: "idle" } : l)), []);

  const dismissTopupNotice = useCallback(() => setLoads((l) => ({ ...l, topupNotice: null })), []);

  return {
    state: state as WorkspaceState,
    loads,
    send,
    pickPhoto,
    clearPhoto,
    setMode,
    addReference,
    removeReference,
    pickAudio,
    clearAudio,
    pickVideo,
    clearVideo,
    reloadBalance: loadBalance,
    requote,
    dismissTopupNotice,
    launch,
    start,
    retryFrom,
    clearLaunchError,
  };
}
