"use client";

import { AudioLines, Mic, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AudioAssetPlayer } from "@/features/ai/text-to-audio/audio-player";
import { deleteAudioAsset, listAudioLibrary, renameAudioAsset, type AudioAssetItem } from "@/lib/ai/text-to-audio/client";
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
export function AudioLibrary({ ttaHref, lipSyncHref, aiHref }: { ttaHref: string; lipSyncHref: string; aiHref: string }) {
  const [state, setState] = useState<{ status: "loading" } | { status: "ready"; assets: AudioAssetItem[] } | { status: "error"; message: string }>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listAudioLibrary(100);
    setState(res.ok ? { status: "ready", assets: res.assets } : { status: "error", message: res.error });
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const rename = useCallback(async (asset: AudioAssetItem) => {
    const next = window.prompt("Name this audio", asset.name);
    if (next === null) return;
    const name = next.trim();
    if (!name || name === asset.name) return;
    setBusy(asset.id);
    const res = await renameAudioAsset(asset.id, name);
    setBusy(null);
    if (res.ok) setState((s) => (s.status === "ready" ? { status: "ready", assets: s.assets.map((a) => (a.id === asset.id ? res.asset : a)) } : s));
  }, []);

  const remove = useCallback(async (asset: AudioAssetItem) => {
    if (!window.confirm(`Delete "${asset.name}"? This cannot be undone.`)) return;
    haptic("medium");
    setBusy(asset.id);
    const res = await deleteAudioAsset(asset.id);
    setBusy(null);
    if (res.ok && res.deleted) setState((s) => (s.status === "ready" ? { status: "ready", assets: s.assets.filter((a) => a.id !== asset.id) } : s));
  }, []);

  return (
    <div className="pb-24">
      <header className="mt-4">
        <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
          Frenz AI · Audio
        </p>
        <h1 className="mt-2 text-[2rem] font-bold leading-[1.06] tracking-[-0.04em] sm:text-[2.4rem]">
          Your <span className="text-gradient">Audio Library</span>
        </h1>
        <p className="mt-2.5 max-w-lg text-[14.5px] leading-relaxed text-muted-foreground">Everything you have made with Text to Audio. Play it, save it to your device, or use it in Lip Sync Pro — reusing it costs nothing.</p>
      </header>

      <Link href={ttaHref} className="ai-cta mt-5 inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-bold text-background">
        <Plus className="h-4 w-4" aria-hidden /> New audio
      </Link>

      <div className="mt-6 space-y-3">
        {state.status === "loading" ? (
          <>
            <div className="h-24 animate-pulse rounded-[1.25rem] bg-secondary/60" aria-busy="true" aria-label="Loading your audio" />
            <div className="h-24 animate-pulse rounded-[1.25rem] bg-secondary/40" />
          </>
        ) : state.status === "error" ? (
          <p className="rounded-2xl bg-rose-500/10 px-3.5 py-2.5 text-[12.5px] text-rose-700 dark:text-rose-300">
            {state.message}{" "}
            <button type="button" onClick={() => void load()} className="font-semibold underline underline-offset-2">
              Try again
            </button>
          </p>
        ) : state.assets.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-border bg-card/60 px-5 py-10 text-center">
            <AudioLines className="mx-auto h-7 w-7 text-primary" aria-hidden />
            <p className="mt-3 text-[15px] font-bold tracking-[-0.01em]">Nothing here yet</p>
            <p className="mx-auto mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted-foreground">Make your first audio and it will be saved here with the name you give it.</p>
            <Link href={ttaHref} className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold">
              Turn text into audio
            </Link>
          </div>
        ) : (
          state.assets.map((a) => (
            <article key={a.id} className={cn("rounded-[1.25rem] border border-border/70 bg-card p-4 transition", busy === a.id && "opacity-60")}>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <AudioLines className="h-4.5 w-4.5" aria-hidden />
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
                  <button type="button" onClick={() => void rename(a)} disabled={busy !== null} aria-label={`Rename ${a.name}`} className="grid h-9 w-9 place-items-center rounded-full border border-border disabled:opacity-50">
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button type="button" onClick={() => void remove(a)} disabled={busy !== null} aria-label={`Delete ${a.name}`} className="grid h-9 w-9 place-items-center rounded-full border border-border text-rose-600 disabled:opacity-50">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
              <AudioAssetPlayer assetId={a.id} durationMs={a.durationMs} className="mt-3.5" />
              <Link
                href={`${lipSyncHref}?audio=${encodeURIComponent(a.id)}`}
                onClick={() => track("audio_library_reused", { from: "library" })}
                className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-secondary px-3.5 text-[12.5px] font-semibold"
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
