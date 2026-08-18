"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Music, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { getMedia, mediaKey } from "@/features/downloads/local-media";
import { toast } from "@/features/ui/toast";
import { downloadUrl } from "@/lib/client-download";
import { computeAudioPeaks } from "@/lib/media/comment-recording";
import { haptic } from "@/lib/motion/haptics";
import { springs } from "@/lib/motion/springs";
import { presignUpload, uploadWithPlan } from "@/lib/storage/client-upload";
import { SOUND_GENRES, SOUND_MOODS, type SoundGenre, type SoundMood } from "@/lib/social/sounds";
import { cn } from "@/lib/utils";
import type { DownloadRecord } from "@/types";

/**
 * "Publish as sound" — turns a downloaded AUDIO item into a public, reusable
 * Sound other people can browse and attach to their own Reels (Feature 15
 * Part 7, owner-approved: shareable, but clearly attributed — never
 * presented as original). Reuses the exact upload pipeline
 * download-player.tsx's "Publish to everyone" already ships (blob already
 * in the browser via the local media cache → presign+PUT, no re-download,
 * no server ever touching raw bytes) plus `computeAudioPeaks` — the same
 * one-time decode `comment-media.tsx`'s voice notes already use for a real
 * waveform, not a decorative one.
 *
 * Audio-kind downloads only for this pass — pulling a shareable audio track
 * out of a downloaded VIDEO would need server-side extraction, a separate,
 * larger piece of work (see docs/FEATURE_15_PART_7_MUSIC.md).
 */
export function PublishSoundSheet({ open, onClose, item }: { open: boolean; onClose: () => void; item: DownloadRecord | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [mood, setMood] = useState<SoundMood | null>(null);
  const [genre, setGenre] = useState<SoundGenre | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState<string | null>(null);
  const [soundId, setSoundId] = useState<string | null>(null);

  // Reset the form for whichever item is currently open, without carrying a
  // previous item's title/artist into the next one.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (item && seededFor !== item.id) {
    setSeededFor(item.id);
    setTitle(item.title.slice(0, 120));
    setArtist(item.platformName || "Unknown artist");
    setMood(null);
    setGenre(null);
    setSoundId(null);
  }

  if (!mounted || !item) return null;

  const publish = async () => {
    if (busy || !title.trim() || !artist.trim()) return;
    setBusy(true);
    haptic("selection");
    try {
      setBusyText("Preparing audio…");
      const key = mediaKey(item.url, item.formatId, item.kind);
      let blob = await getMedia(key);
      if (!blob) {
        const res = await fetch(downloadUrl({ url: item.url, formatId: item.formatId, kind: item.kind, title: item.title }));
        if (!res.ok) throw new Error();
        blob = await res.blob();
      }

      const { peaks, durationMs } = await computeAudioPeaks(blob);

      setBusyText("Uploading…");
      const contentType = blob.type || "audio/mpeg";
      const plan = await presignUpload("audio", "mp3");
      const audioUrl = await uploadWithPlan(plan, blob, contentType);

      setBusyText("Publishing…");
      const res = await fetch("/api/sounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          artistLabel: artist.trim(),
          audioUrl,
          waveformPeaks: peaks,
          durationSec: Math.round(durationMs / 1000),
          moodTag: mood,
          genreTag: genre,
          sourcePlatform: item.platform,
          sourceUrl: item.url,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't publish.");
      setSoundId(json.soundId as string);
      toast("Sound published.", "success", { duration: 2500 });
    } catch (e) {
      toast(e instanceof Error && e.message !== "" ? e.message : "Couldn't publish this sound.", "error");
    } finally {
      setBusy(false);
      setBusyText(null);
    }
  };

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Publish as sound"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={springs.sheet}
            className="relative m-2 w-full max-w-md overflow-hidden rounded-3xl border border-border/60 bg-card shadow-2xl"
          >
            <div className="mx-auto mt-2.5 mb-1 h-1 w-9 rounded-full bg-border" />
            <div className="flex items-center justify-between px-4 pt-2">
              <h2 className="text-base font-bold">Publish as sound</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary">
                <X className="h-4 w-4" />
              </button>
            </div>

            {soundId ? (
              <div className="p-5 text-center">
                <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white">
                  <Music className="h-6 w-6" />
                </span>
                <p className="text-sm font-semibold">Your sound is live</p>
                <p className="mt-1 text-xs text-muted-foreground">Other people can now find and use it in their own Reels.</p>
                <Link
                  href={`/sound/${soundId}`}
                  onClick={onClose}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-secondary py-3 text-sm font-semibold transition hover:bg-secondary/70"
                >
                  View sound page
                </Link>
              </div>
            ) : (
              <div className="space-y-3 p-4">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  This audio came from {item.platformName || "an external source"} — it will be credited on the sound's page and everywhere it's used, never presented as original.
                </p>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">Title</span>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                    className="w-full rounded-xl bg-secondary/50 px-3.5 py-2.5 text-sm outline-none ring-1 ring-inset ring-transparent focus:ring-2 focus:ring-primary/40"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">Artist</span>
                  <input
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    maxLength={80}
                    className="w-full rounded-xl bg-secondary/50 px-3.5 py-2.5 text-sm outline-none ring-1 ring-inset ring-transparent focus:ring-2 focus:ring-primary/40"
                  />
                </label>
                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Mood (optional)</span>
                  <div className="flex flex-wrap gap-1.5">
                    {SOUND_MOODS.map((m) => (
                      <TagChip key={m} active={mood === m} onClick={() => setMood(mood === m ? null : m)}>
                        {m}
                      </TagChip>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Genre (optional)</span>
                  <div className="flex flex-wrap gap-1.5">
                    {SOUND_GENRES.map((g) => (
                      <TagChip key={g} active={genre === g} onClick={() => setGenre(genre === g ? null : g)}>
                        {g}
                      </TagChip>
                    ))}
                  </div>
                </div>
                {busyText ? <p className="text-xs text-muted-foreground">{busyText}</p> : null}
                <button
                  type="button"
                  onClick={publish}
                  disabled={busy || !title.trim() || !artist.trim()}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 py-3.5 text-sm font-bold text-white transition hover:opacity-95 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {busy ? (busyText ?? "Publishing…") : "Publish"}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function TagChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize transition",
        active ? "bg-foreground text-background" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
