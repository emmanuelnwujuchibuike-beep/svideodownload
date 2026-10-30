"use client";

import { Loader2, Music, Upload, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { toast } from "@/features/ui/toast";
import { computeAudioPeaks } from "@/lib/media/comment-recording";
import { presignUpload, uploadWithPlan } from "@/lib/storage/client-upload";
import { SOUND_GENRES, SOUND_MOODS, type SoundGenre, type SoundMood } from "@/lib/social/sounds-shared";
import { cn } from "@/lib/utils";

/** Longer than this is not a sound for a Reel (and keeps the decode for the waveform quick). */
const MAX_SOUND_SECONDS = 600;
const MAX_SOUND_BYTES = 25 * 1024 * 1024;

/**
 * "Upload a sound" — the Sounds page's + button (design/frenz-sounds.html; owner, 2026-10-30: "uploaded sounds too
 * works"). An audio file from the member's device becomes a public sound others can use: measured once in the browser
 * for its real waveform and length (computeAudioPeaks, the voice notes' decode), uploaded through the same presigned
 * pipeline as every other upload, then recorded by POST /api/sounds. The member names the artist — a song that isn't
 * theirs is credited to whoever made it.
 */
export function UploadSoundSheet({ open, onClose, onPublished }: { open: boolean; onClose: () => void; onPublished?: (soundId: string) => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [mood, setMood] = useState<SoundMood | null>(null);
  const [genre, setGenre] = useState<SoundGenre | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [soundId, setSoundId] = useState<string | null>(null);

  if (!mounted || !open) return null;

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("audio/")) return toast("Choose an audio file.", "error");
    if (f.size > MAX_SOUND_BYTES) return toast("That file is over 25 MB.", "error");
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 120));
  };

  const publish = async () => {
    if (!file || busy || !title.trim() || !artist.trim()) return;
    try {
      setBusy("Reading the audio…");
      const { peaks, durationMs } = await computeAudioPeaks(file);
      if (durationMs / 1000 > MAX_SOUND_SECONDS) throw new Error("That sound is over 10 minutes.");
      setBusy("Uploading…");
      const ext = (file.name.match(/\.([a-z0-9]{1,5})$/i)?.[1] ?? "mp3").toLowerCase();
      const audioUrl = await uploadWithPlan(await presignUpload("audio", ext), file, file.type || "audio/mpeg");
      setBusy("Publishing…");
      const res = await fetch("/api/sounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), artistLabel: artist.trim(), audioUrl, waveformPeaks: peaks, durationSec: Math.round(durationMs / 1000), moodTag: mood, genreTag: genre }),
      });
      const j = (await res.json().catch(() => null)) as { soundId?: string; error?: string } | null;
      if (!res.ok || !j?.soundId) throw new Error(j?.error ?? "Couldn't publish this sound.");
      setSoundId(j.soundId);
      onPublished?.(j.soundId);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Couldn't publish this sound.", "error");
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-md" />
      <div role="dialog" aria-modal="true" aria-label="Upload a sound" className="relative m-2 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-frenz-line bg-frenz-card text-frenz-ink shadow-2xl">
        <div className="mx-auto mb-1 mt-2.5 h-1 w-9 rounded-full bg-frenz-line" />
        <div className="flex items-center justify-between px-4 pt-2">
          <h2 className="text-base font-bold">Upload a sound</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-frenz-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {soundId ? (
          <div className="p-5 text-center">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-frenz-violet text-white">
              <Music className="h-6 w-6" />
            </span>
            <p className="text-sm font-semibold">Your sound is live</p>
            <p className="mt-1 text-xs text-frenz-muted">Anyone can now find it and use it in their own Reels.</p>
            <Link href={`/sound/${soundId}`} onClick={onClose} className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-frenz-fill py-3 text-sm font-semibold">
              View sound page
            </Link>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            <input ref={input} type="file" accept="audio/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            <button type="button" onClick={() => input.current?.click()} className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-frenz-line bg-frenz-fill p-4 text-left">
              <Upload className="h-5 w-5 shrink-0 text-frenz-violet" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{file ? file.name : "Choose an audio file"}</span>
                <span className="block text-xs text-frenz-muted">MP3, M4A, WAV · up to 25 MB</span>
              </span>
            </button>
            <Field label="Title" value={title} onChange={setTitle} max={120} />
            <Field label="Artist" value={artist} onChange={setArtist} max={80} placeholder="Who made it — you, or the artist" />
            <Tags label="Mood (optional)" all={SOUND_MOODS} value={mood} onChange={setMood} />
            <Tags label="Genre (optional)" all={SOUND_GENRES} value={genre} onChange={setGenre} />
            <button
              type="button"
              onClick={() => void publish()}
              disabled={!!busy || !file || !title.trim() || !artist.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-frenz-violet py-3.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ?? "Publish sound"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, value, onChange, max, placeholder }: { label: string; value: string; onChange: (v: string) => void; max: number; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-frenz-muted">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={max} placeholder={placeholder} className="w-full rounded-xl bg-frenz-fill px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-frenz-violet/40" />
    </label>
  );
}

function Tags<T extends string>({ label, all, value, onChange }: { label: string; all: readonly T[]; value: T | null; onChange: (v: T | null) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-frenz-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {all.map((t) => (
          <button key={t} type="button" aria-pressed={value === t} onClick={() => onChange(value === t ? null : t)} className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize", value === t ? "bg-frenz-ink text-frenz-page" : "bg-frenz-fill text-frenz-muted")}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
