"use client";

import { motion } from "framer-motion";
import { ChevronLeft, Loader2, Lock, Mic, Pause, Play, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AUDIO_MIME_CANDIDATES, VOICE_MAX_MS, computeAudioPeaks, extForMime, fmtDuration, pickMimeType } from "@/lib/media/comment-recording";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { springs } from "@/lib/motion/springs";
import { cn } from "@/lib/utils";

const LIVE_BARS = 42;

/**
 * WhatsApp/Instagram-style voice-note recorder: takes over the composer's
 * input row the moment it mounts (permission is requested immediately — the
 * mic button that renders this already signalled record intent), shows a
 * live reactive waveform while recording, then a scrubbable preview of
 * EXACTLY the waveform that will be stored (computed once, real peak data —
 * not a decorative fake) before sending.
 */
export function VoiceRecorder({
  onRecorded,
  onCancel,
  holdGesture = null,
  autoStopAndSend = false,
}: {
  onRecorded: (result: { url: string; durationMs: number; waveform: number[] }) => void;
  onCancel: () => void;
  /** Owner mockup's hold-to-record gesture: the mic button now starts this
   *  SAME recorder on a press-and-hold (not just a tap), and the parent
   *  tracks the finger's continued movement (this component's own DOM
   *  swapped in mid-gesture, so tracking must live in the parent via
   *  window-level listeners, not element pointer-capture). `null` — the
   *  default, and every existing tap-to-open call site — renders and
   *  behaves EXACTLY as before this feature existed. */
  holdGesture?: { dragX: number; dragY: number; canceled: boolean; locked: boolean } | null;
  /** Set true the instant a hold gesture is released without crossing the
   *  cancel/lock thresholds — auto-stops and sends the short clip, matching
   *  WhatsApp's press-release-send. */
  autoStopAndSend?: boolean;
}) {
  const [phase, setPhase] = useState<"starting" | "recording" | "preview" | "uploading" | "error">("starting");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(0);
  // Created ONCE when recording stops, not derived in render — computing
  // `URL.createObjectURL` inline in JSX would mint a new blob URL (and
  // restart playback) on every re-render, including every timeupdate tick.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const mimeRef = useRef("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const elapsedMsRef = useRef(0);
  const lastSampleAtRef = useRef(0);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const abortingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    if (analyser) {
      const now = performance.now();
      if (now - lastSampleAtRef.current > 70) {
        lastSampleAtRef.current = now;
        const data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data);
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i]! - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / data.length);
        const amp = Math.min(100, Math.round(rms * 260));
        setBars((b) => [...b.slice(-(LIVE_BARS - 1)), amp]);
      }
      const elapsed = performance.now() - startedAtRef.current;
      elapsedMsRef.current = elapsed;
      setElapsedMs(elapsed);
      if (elapsed >= VOICE_MAX_MS) {
        stop();
        return;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mime = pickMimeType(AUDIO_MIME_CANDIDATES);
      mimeRef.current = mime;
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        // An explicit hold-gesture cancel skips finish()/preview entirely —
        // there's nothing to preview, the whole point is "never happened."
        if (abortingRef.current) return;
        void finish();
      };
      recorderRef.current = recorder;
      recorder.start(250);

      startedAtRef.current = performance.now();
      lastSampleAtRef.current = 0;
      setPhase("recording");
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setErr("Couldn't access your microphone. Check your browser's permission for this site.");
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void start();
    return () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopStream();
  }

  async function finish() {
    const blob = new Blob(chunksRef.current, { type: mimeRef.current || "audio/webm" });
    blobRef.current = blob;
    setPreviewUrl(URL.createObjectURL(blob));
    try {
      const { peaks: p, durationMs: d } = await computeAudioPeaks(blob);
      setPeaks(p);
      setDurationMs(d || elapsedMsRef.current);
    } catch {
      // Decode failed (rare codec edge case) — still let them send; render a
      // flat waveform rather than blocking the whole feature on this.
      setPeaks(Array.from({ length: 46 }, () => 30));
      setDurationMs(elapsedMsRef.current);
    }
    setPhase("preview");
  }

  const discard = () => {
    blobRef.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    onCancel();
  };

  const togglePreviewPlay = () => {
    const el = previewRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const send = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    setPhase("uploading");
    try {
      const ext = extForMime(mimeRef.current);
      const url = await uploadPostMedia({ data: blob, kind: "audio", ext, contentType: blob.type || "audio/webm" });
      onRecorded({ url, durationMs: durationMs || elapsedMs, waveform: peaks });
    } catch {
      setErr("Couldn't send the voice note. Try again.");
      setPhase("preview");
    }
  };

  // Hold-gesture cancel: the finger slid past the cancel threshold while
  // still down — abort immediately, no preview/upload, matching "never
  // happened." Guarded so it only fires once per gesture.
  useEffect(() => {
    if (!holdGesture?.canceled || phase !== "recording") return;
    abortingRef.current = true;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopStream();
    onCancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdGesture?.canceled, phase]);

  // Hold-gesture release without cancel/lock: stop now, then auto-send the
  // instant finish() lands the preview — the owner mockup's press-release-
  // send, no manual tap needed for a short clip.
  useEffect(() => {
    if (!autoStopAndSend) return;
    if (phase === "recording") stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStopAndSend, phase]);
  useEffect(() => {
    if (autoStopAndSend && phase === "preview") void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStopAndSend, phase]);

  if (phase === "error") {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-sm text-rose-500">
        <span className="flex-1">{err}</span>
        <button type="button" onClick={onCancel} className="shrink-0 font-semibold hover:underline">Dismiss</button>
      </div>
    );
  }

  if (phase === "preview" || phase === "uploading") {
    const maxPeak = Math.max(1, ...peaks);
    return (
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={springs.press} className="flex items-center gap-2 rounded-3xl border border-border/60 bg-card/70 p-2 shadow-soft backdrop-blur-xl">
        <button type="button" onClick={discard} aria-label="Discard voice note" disabled={phase === "uploading"} className="shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-rose-500 disabled:opacity-40">
          <Trash2 className="h-5 w-5" />
        </button>
        <button type="button" onClick={togglePreviewPlay} aria-label={playing ? "Pause" : "Play"} disabled={phase === "uploading"} className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 p-2 text-white shadow-md shadow-violet-500/30 disabled:opacity-60">
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <audio
          ref={previewRef}
          src={previewUrl ?? undefined}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setPlayProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
          className="hidden"
        />
        {/* min-w-0 lets this flex child actually shrink — without it a flex
            item refuses to go below its content's intrinsic width (here, 46
            fixed-width bars), which is exactly what forced the whole
            composer row wider than the screen on narrow phones. Bars are
            flex-1 (not a fixed px width) so they always divide up exactly
            the space available instead of demanding a fixed total. */}
        <div className="flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
          {peaks.map((p, i) => (
            <span
              key={i}
              className={cn("min-w-[1px] flex-1 rounded-full transition-colors", i / peaks.length <= playProgress ? "bg-gradient-to-b from-blue-500 to-violet-500" : "bg-secondary")}
              style={{ height: `${Math.max(12, (p / maxPeak) * 100)}%` }}
            />
          ))}
        </div>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{fmtDuration(durationMs)}</span>
        <motion.button type="button" onClick={send} disabled={phase === "uploading"} whileTap={{ scale: 0.88 }} aria-label="Send voice note" className="shrink-0 rounded-full bg-gradient-to-r from-blue-600 to-violet-600 p-2 text-white shadow-md shadow-violet-500/30 transition hover:opacity-95 disabled:opacity-60">
          {phase === "uploading" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </motion.button>
        {err ? <span className="text-xs text-rose-500">{err}</span> : null}
      </motion.div>
    );
  }

  // Hold-gesture in progress (owner mockup: press-and-hold the mic, slide
  // left to cancel or up to lock) — replaces the normal Trash/Stop controls
  // with a live "slide to cancel" bar while the finger is still down and
  // neither threshold has been crossed yet. A plain tap never sets
  // `holdGesture` at all, so it never reaches this branch.
  if (holdGesture && !holdGesture.locked && !holdGesture.canceled && (phase === "starting" || phase === "recording")) {
    const lockProgress = Math.min(1, Math.max(0, -holdGesture.dragY / 80));
    return (
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="relative flex items-center gap-2 rounded-3xl border border-border/60 bg-card/70 p-2 shadow-soft backdrop-blur-xl">
        <span
          aria-hidden
          className={cn(
            "absolute -top-11 right-2 flex h-9 w-9 items-center justify-center rounded-full shadow-md transition-colors",
            lockProgress > 0.9 ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white" : "bg-secondary text-muted-foreground",
          )}
          style={{ transform: `translateY(${-lockProgress * 6}px)` }}
        >
          <Lock className="h-4 w-4" />
        </span>
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500/60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
        </span>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{fmtDuration(elapsedMs)}</span>
        <span
          aria-hidden
          className="flex flex-1 items-center justify-center gap-1 text-xs font-medium text-muted-foreground"
          style={{ transform: `translateX(${Math.min(0, holdGesture.dragX)}px)`, opacity: Math.max(0.3, 1 - Math.abs(holdGesture.dragX) / 140) }}
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Slide to cancel
        </span>
      </motion.div>
    );
  }

  // "starting" and "recording"
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={springs.press} className="flex items-center gap-2 rounded-3xl border border-border/60 bg-card/70 p-2 shadow-soft backdrop-blur-xl">
      <button type="button" onClick={onCancel} aria-label="Cancel recording" className="shrink-0 rounded-full p-2 text-muted-foreground transition hover:bg-secondary hover:text-rose-500">
        <Trash2 className="h-5 w-5" />
      </button>
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500/60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
      </span>
      <div className="flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
        {phase === "starting" ? (
          <span className="truncate text-xs text-muted-foreground">Requesting microphone…</span>
        ) : (
          Array.from({ length: LIVE_BARS }).map((_, i) => {
            const v = bars[bars.length - LIVE_BARS + i] ?? 6;
            return <span key={i} className="min-w-[1px] flex-1 rounded-full bg-gradient-to-b from-blue-500 to-violet-500 transition-[height] duration-100" style={{ height: `${Math.max(10, v)}%` }} />;
          })
        )}
      </div>
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{fmtDuration(elapsedMs)}</span>
      <motion.button type="button" onClick={stop} disabled={phase !== "recording"} whileTap={{ scale: 0.88 }} aria-label="Stop recording" className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 p-2 text-white shadow-md shadow-violet-500/30 disabled:opacity-60">
        <Mic className="h-5 w-5" />
      </motion.button>
    </motion.div>
  );
}
