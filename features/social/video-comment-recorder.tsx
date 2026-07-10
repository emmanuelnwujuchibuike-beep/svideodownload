"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Play, RotateCcw, Send, SwitchCamera, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { VIDEO_MAX_MS, VIDEO_MIME_CANDIDATES, captureVideoFrame, extForMime, fmtDuration, pickMimeType } from "@/lib/media/comment-recording";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { cn } from "@/lib/utils";

const RING_R = 34;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Full-screen short video-reply recorder — front-camera-first, capped at
 * VIDEO_MAX_MS, with a live progress ring on the shutter (Stories-style), a
 * camera-flip button, and a preview stage before sending. Portaled to
 * document.body (house rule: every overlay portals itself, never trusts the
 * caller's DOM position/overflow).
 */
export function VideoCommentRecorder({
  onRecorded,
  onClose,
}: {
  onRecorded: (result: { url: string; durationMs: number; thumbnailUrl: string | null }) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"starting" | "live" | "recording" | "preview" | "uploading" | "error">("starting");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [thumbBlob, setThumbBlob] = useState<Blob | null>(null);
  const [playing, setPlaying] = useState(false);

  const liveRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const mimeRef = useRef("");
  const startedAtRef = useRef(0);
  const elapsedMsRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Lock the page behind the modal, matching every other full-screen overlay.
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const openCamera = useCallback(async (mode: "user" | "environment") => {
    setPhase("starting");
    setErr(null);
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode }, audio: true });
      streamRef.current = stream;
      if (liveRef.current) {
        liveRef.current.srcObject = stream;
        await liveRef.current.play().catch(() => {});
      }
      setPhase("live");
    } catch {
      setErr("Couldn't access your camera. Check your browser's permission for this site.");
      setPhase("error");
    }
  }, [stopStream]);

  useEffect(() => {
    void openCamera(facing);
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flipCamera = () => {
    const next = facing === "user" ? "environment" : "user";
    setFacing(next);
    void openCamera(next);
  };

  const tick = useCallback(() => {
    const elapsed = performance.now() - startedAtRef.current;
    elapsedMsRef.current = elapsed;
    setElapsedMs(elapsed);
    if (elapsed >= VIDEO_MAX_MS) {
      stopRecording();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = pickMimeType(VIDEO_MIME_CANDIDATES);
    mimeRef.current = mime;
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => void finish();
    recorderRef.current = recorder;
    recorder.start(250);
    startedAtRef.current = performance.now();
    setPhase("recording");
    rafRef.current = requestAnimationFrame(tick);
  };

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  async function finish() {
    stopStream();
    const blob = new Blob(chunksRef.current, { type: mimeRef.current || "video/webm" });
    blobRef.current = blob;
    setPreviewUrl(URL.createObjectURL(blob));
    setPhase("preview");
  }

  // Grab a poster frame once the recorded preview has a real first frame.
  const onPreviewLoaded = async () => {
    const v = previewVideoRef.current;
    if (!v || thumbBlob) return;
    try {
      const b = await captureVideoFrame(v);
      if (b) setThumbBlob(b);
    } catch {
      /* poster is best-effort */
    }
  };

  const retake = () => {
    blobRef.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setThumbBlob(null);
    setElapsedMs(0);
    void openCamera(facing);
  };

  const togglePreviewPlay = () => {
    const el = previewVideoRef.current;
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
      const url = await uploadPostMedia({ data: blob, kind: "video", ext, contentType: blob.type || "video/webm" });
      let thumbnailUrl: string | null = null;
      if (thumbBlob) {
        try {
          thumbnailUrl = await uploadPostMedia({ data: thumbBlob, kind: "image", ext: "jpg", contentType: "image/jpeg" });
        } catch {
          /* poster is best-effort — the video still sends without one */
        }
      }
      onRecorded({ url, durationMs: elapsedMsRef.current, thumbnailUrl });
    } catch {
      setErr("Couldn't send the video. Try again.");
      setPhase("preview");
    }
  };

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const progress = Math.min(1, elapsedMs / VIDEO_MAX_MS);

  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[130] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="Record a video reply">
      <div className="flex items-center justify-between p-4">
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20">
          <X className="h-5 w-5" />
        </button>
        {phase === "recording" ? (
          <span className="rounded-full bg-black/40 px-3 py-1 text-sm font-bold tabular-nums text-white backdrop-blur">{fmtDuration(elapsedMs)} / {fmtDuration(VIDEO_MAX_MS)}</span>
        ) : (
          <span className="text-sm font-semibold text-white/70">Video reply</span>
        )}
        {phase === "live" ? (
          <button type="button" onClick={flipCamera} aria-label="Flip camera" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20">
            <SwitchCamera className="h-5 w-5" />
          </button>
        ) : (
          <span className="h-10 w-10" />
        )}
      </div>

      <div className="relative flex-1 overflow-hidden">
        {phase === "error" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm text-white/80">{err}</p>
            <button type="button" onClick={() => void openCamera(facing)} className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20">Try again</button>
          </div>
        ) : phase === "starting" ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-white/60" />
          </div>
        ) : phase === "preview" || phase === "uploading" ? (
          <button type="button" onClick={togglePreviewPlay} aria-label={playing ? "Pause preview" : "Play preview"} className="relative h-full w-full">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={previewVideoRef}
              src={previewUrl ?? undefined}
              loop
              playsInline
              autoPlay
              onLoadedData={onPreviewLoaded}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              className="h-full w-full object-contain"
            />
            <AnimatePresence>
              {!playing ? (
                <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md">
                    <Play className="h-7 w-7 fill-white" />
                  </span>
                </motion.span>
              ) : null}
            </AnimatePresence>
          </button>
        ) : (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video ref={liveRef} muted playsInline autoPlay className={cn("h-full w-full object-cover", facing === "user" && "-scale-x-100")} />
        )}
      </div>

      <div className="flex items-center justify-center gap-8 p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
        {phase === "live" || phase === "recording" ? (
          <button
            type="button"
            onClick={phase === "recording" ? stopRecording : startRecording}
            aria-label={phase === "recording" ? "Stop recording" : "Start recording"}
            className="relative flex h-20 w-20 items-center justify-center"
          >
            <svg viewBox="0 0 80 80" className="absolute inset-0 h-20 w-20 -rotate-90">
              <circle cx="40" cy="40" r={RING_R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="4" />
              {phase === "recording" ? (
                <circle cx="40" cy="40" r={RING_R} fill="none" stroke="url(#vgrad)" strokeWidth="4" strokeLinecap="round" strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - progress)} />
              ) : null}
              <defs>
                <linearGradient id="vgrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#2563eb" />
                  <stop offset="100%" stopColor="#7c3aed" />
                </linearGradient>
              </defs>
            </svg>
            <span className={cn("rounded-full bg-white transition-all", phase === "recording" ? "h-7 w-7 rounded-lg bg-rose-500" : "h-16 w-16")} />
          </button>
        ) : phase === "preview" || phase === "uploading" ? (
          <>
            <button type="button" onClick={retake} disabled={phase === "uploading"} aria-label="Retake" className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20 disabled:opacity-50">
              <RotateCcw className="h-6 w-6" />
            </button>
            <motion.button type="button" onClick={send} disabled={phase === "uploading"} whileTap={{ scale: 0.9 }} aria-label="Send video reply" className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-violet-500/40 disabled:opacity-60">
              {phase === "uploading" ? <Loader2 className="h-6 w-6 animate-spin" /> : <Send className="h-6 w-6" />}
            </motion.button>
            <button type="button" onClick={onClose} disabled={phase === "uploading"} aria-label="Discard" className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20 disabled:opacity-50">
              <Trash2 className="h-6 w-6" />
            </button>
          </>
        ) : null}
      </div>
      {err && phase !== "error" ? <p className="pb-4 text-center text-xs text-rose-400">{err}</p> : null}
    </motion.div>,
    document.body,
  );
}
