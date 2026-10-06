"use client";

import { AudioLines, Mic, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { aiButtonClass } from "@/features/ai/design/ai-button";
import { AiCreditStrip } from "@/features/ai/design/ai-credit-strip";
import { AiShowcase } from "@/features/ai/design/ai-showcase";
import { AiToolTitle } from "@/features/ai/design/ai-surface";
import { useCallback, useState } from "react";

import { useCachedView } from "@/features/ai/core/use-cached-view";
import { AudioAssetPlayer } from "@/features/ai/text-to-audio/audio-player";
import { deleteAudioAsset, listAudioLibrary, renameAudioAsset, type AudioAssetItem } from "@/lib/ai/text-to-audio/client";
import type { ShowcaseSlide } from "@/lib/ai/showcase/slides";
import { track } from "@/lib/analytics/client";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE AUDIO LIBRARY (the brief §6)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Name · duration · voice/model used · creation date · character count ·
 * play · download · delete · use in Lip Sync Pro." One list, one row per
 * saved generation, each row a player that fetches its signed URL only when
 * pressed — so a long library costs one request to open and nothing to
 * scroll.
 */
export function AudioLibrary({
  ttaHref,
  lipSyncHref,
  aiHref,
  slides = [],
}: {
  ttaHref: string;
  lipSyncHref: string;
  aiHref: string;
  /** The showcase — large screens only on every AI page that is not the welcome or Explore (owner, 2026-10-05). */
  slides?: ShowcaseSlide[];
}) {
  const [busy, setBusy] = useState<string | null>(null);
  /* Remembered on the device — same reasoning as the Voice Library beside it. */
  const view = useCachedView<AudioAssetItem[]>("audio-library", async () => {
    const res = await listAudioLibrary(100);
    return res.ok ? { ok: true as const, value: res.assets } : { ok: false as const, error: res.error };
  });
  const load = view.refresh;
  const state: { status: "loading" } | { status: "ready"; assets: AudioAssetItem[] } | { status: "error"; message: string } = view.data
    ? { status: "ready", assets: view.data }
    : view.error
      ? { status: "error", message: view.error }
      : { status: "loading" };

  const rename = useCallback(async (asset: AudioAssetItem) => {
    const next = window.prompt("Name this audio", asset.name);
    if (next === null) return;
    const name = next.trim();
    if (!name || name === asset.name) return;
    setBusy(asset.id);
    const res = await renameAudioAsset(asset.id, name);
    setBusy(null);
    if (res.ok && view.data) view.set(view.data.map((a) => (a.id === asset.id ? res.asset : a)));
  }, [view]);

  const remove = useCallback(async (asset: AudioAssetItem) => {
    if (!window.confirm(`Delete "${asset.name}"? This cannot be undone.`)) return;
    haptic("medium");
    setBusy(asset.id);
    const res = await deleteAudioAsset(asset.id);
    setBusy(null);
    if (res.ok && res.deleted && view.data) view.set(view.data.filter((a) => a.id !== asset.id));
  }, [view]);

  return (
    <div className="pb-24">
        {/*
          The shared hero (owner, 2026-09-28). This opened with the uppercase
          "Frenz AI · Audio" eyebrow — the same pasted string Voice Cloning
          carried, so three different screens announced themselves as one
          tool. §1 of the brief: avoid excessive uppercase labels.
        */}
      {/* Redesign page 8 (owner's reference): showcase on large screens, the credits strip, the page's own title, one primary action. */}
      <AiShowcase slides={slides} base={aiHref} desktopOnly className="mt-3 mb-3" />
      <AiCreditStrip base={aiHref} className="mt-3 lg:mt-0" />
      <AiToolTitle
        icon={AudioLines}
        title="Your Audios"
        tagline="Everything you made with Text to Audio."
        body="Play it, save it to your device, or use it in Lip Sync Pro — reusing it costs nothing."
        className="mt-6"
      />

      <Link href={ttaHref} className={aiButtonClass({ className: "mt-5" })}>
        <Plus className="h-4 w-4" aria-hidden /> New audio
      </Link>

      <div className="mt-6 space-y-3">
        {state.status === "loading" ? (
          <>
            <div className="h-[9.5rem] animate-pulse rounded-[1.375rem] bg-secondary/60" aria-busy="true" aria-label="Loading your audio" />
            <div className="h-[9.5rem] animate-pulse rounded-[1.375rem] bg-secondary/40" />
          </>
        ) : state.status === "error" ? (
          <p className="rounded-2xl bg-rose-500/10 px-3.5 py-2.5 text-[12.5px] text-rose-700 dark:text-rose-300">
            {state.message}{" "}
            <button type="button" onClick={() => void load()} className="font-semibold underline underline-offset-2">
              Try again
            </button>
          </p>
        ) : state.assets.length === 0 ? (
          <div className="rounded-[1.375rem] border-[1.5px] border-dashed border-indigo-300/70 bg-indigo-50/30 px-5 py-10 text-center">
            <AudioLines className="mx-auto h-7 w-7 text-primary" aria-hidden />
            <p className="mt-3 text-[15px] font-bold tracking-[-0.01em]">Nothing here yet</p>
            <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted-foreground">Make your first audio and it will be saved here with the name you give it.</p>
            <Link href={ttaHref} className={aiButtonClass({ variant: "secondary", className: "ai-btn--round mt-4" })}>
              Turn text into audio
            </Link>
          </div>
        ) : (
          state.assets.map((a) => (
            <article key={a.id} className={cn("rounded-[1.375rem] bg-card p-4 ring-1 ring-inset ring-black/[0.07] shadow-[0_8px_24px_-20px_rgba(30,40,90,0.45)] transition", busy === a.id && "opacity-60")}>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 text-white shadow-[0_6px_12px_-6px_rgba(99,102,241,0.7)]">
                  <AudioLines className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-bold tracking-[-0.01em]">{a.name}</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {a.durationMs ? `${Math.max(1, Math.round(a.durationMs / 1000))} s · ` : ""}
                    {a.characters.toLocaleString("en-US")} characters · {new Date(a.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                    {a.languageCode ? ` · ${a.languageCode.toUpperCase()}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => void rename(a)} disabled={busy !== null} aria-label={`Rename ${a.name}`} className="grid h-9 w-9 place-items-center rounded-full ring-1 ring-inset ring-black/[0.08] transition hover:bg-secondary disabled:opacity-50">
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button type="button" onClick={() => void remove(a)} disabled={busy !== null} aria-label={`Delete ${a.name}`} className="grid h-9 w-9 place-items-center rounded-full text-rose-600 ring-1 ring-inset ring-black/[0.08] transition hover:bg-rose-50 disabled:opacity-50">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
              <AudioAssetPlayer assetId={a.id} durationMs={a.durationMs} className="mt-3.5" />
              <Link
                href={`${lipSyncHref}?audio=${encodeURIComponent(a.id)}`}
                onClick={() => track("audio_library_reused", { from: "library" })}
                className={aiButtonClass({ variant: "secondary", size: "sm", className: "ai-btn--round mt-3" })}
              >
                <Mic className="h-3.5 w-3.5 text-primary" aria-hidden /> Use in Lip Sync Pro
              </Link>
            </article>
          ))
        )}
      </div>

      <p className="mt-6 text-center text-[11.5px] text-muted-foreground">
        <Link href={aiHref} className="underline-offset-2 hover:underline">
          Back to Frenz AI
        </Link>
      </p>
    </div>
  );
}
