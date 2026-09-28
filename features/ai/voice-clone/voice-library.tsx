"use client";

import { AudioLines, Mic, Pencil, Plus, ShieldCheck, Sparkles, Trash2, Type } from "lucide-react";
import Link from "next/link";
import { AiHero } from "@/features/ai/design/ai-surface";
import { useCallback, useState } from "react";

import { useCachedView } from "@/features/ai/core/use-cached-view";
import { VoiceSamplePlayer } from "@/features/ai/voice-clone/voice-sample-player";
import { deleteVoiceCloneItem, listVoiceCloneLibrary, renameVoiceCloneItem, type VoiceCloneItem } from "@/lib/ai/voice-clone/client";
import { track } from "@/lib/analytics/client";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE VOICE LIBRARY — the voices a member owns
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Name · how much audio it was built from · when · play the recording ·
 * rename · delete · and the two doors that make it worth having: Text to Audio
 * and Lip Sync Pro.
 *
 * ── 🔴 DELETE SAYS WHAT IT ACTUALLY DOES ────────────────────────────────────
 * It removes the voice at the provider, not just a row here — so it cannot be
 * undone, and the recordings go with it. The confirmation says both, because a
 * member who reads "delete" and means "hide from this list" has been misled by
 * the button rather than by their own carelessness.
 */
export function VoiceLibrary({ cloneHref, ttaHref, lipSyncHref, compact = false }: { cloneHref: string; ttaHref: string; lipSyncHref: string; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  /*
    2026-09-27: remembered on the device, so coming back to the library paints
    the voices on the first frame instead of two grey skeletons and a round
    trip. A rename or a delete updates the snapshot in place (`view.set`), so
    the list is still correct without a refetch; a pull-to-refresh is what goes
    back to the network (features/ai/core/use-cached-view.ts).
  */
  const view = useCachedView<{ voices: VoiceCloneItem[]; slots: { used: number; total: number } }>("voice-library", async () => {
    const res = await listVoiceCloneLibrary();
    return res.ok ? { ok: true as const, value: { voices: res.voices, slots: res.slots } } : { ok: false as const, error: res.error };
  });
  const load = view.refresh;
  const state: { status: "loading" } | { status: "ready"; voices: VoiceCloneItem[]; slots: { used: number; total: number } } | { status: "error"; message: string } = view.data
    ? { status: "ready", voices: view.data.voices, slots: view.data.slots }
    : view.error
      ? { status: "error", message: view.error }
      : { status: "loading" };

  const rename = useCallback(async (voice: VoiceCloneItem) => {
    const next = window.prompt("Name this voice", voice.name);
    if (next === null) return;
    const name = next.trim();
    if (!name || name === voice.name) return;
    setBusy(voice.id);
    const res = await renameVoiceCloneItem(voice.id, name);
    setBusy(null);
    if (res.ok && view.data) view.set({ ...view.data, voices: view.data.voices.map((v) => (v.id === voice.id ? res.voice : v)) });
  }, [view]);

  const remove = useCallback(async (voice: VoiceCloneItem) => {
    if (!window.confirm(`Delete "${voice.name}"?\n\nThe voice and the recordings it was built from are removed for good, and anything you make with it from now on will need a new voice. This cannot be undone.`)) return;
    haptic("medium");
    setBusy(voice.id);
    const res = await deleteVoiceCloneItem(voice.id);
    setBusy(null);
    if (res.ok && res.deleted) {
      if (view.data) view.set({ voices: view.data.voices.filter((v) => v.id !== voice.id), slots: { ...view.data.slots, used: Math.max(0, view.data.slots.used - 1) } });
      track("voice_clone_deleted", {});
    } else if (!res.ok) {
      window.alert(res.error);
    }
  }, [view]);

  return (
    <div className={compact ? "" : "pb-24"}>
      {compact ? null : (
        <header className="mt-4">
        {/*
          The shared hero (owner, 2026-09-28). This opened with the uppercase
          "Frenz AI · Audio" eyebrow — the same pasted string Voice Cloning
          carried, so three different screens announced themselves as one
          tool. §1 of the brief: avoid excessive uppercase labels.
        */}
          <AiHero
            tool="Your Voices"
            title="Your"
            highlight="Voices"
            subtitle="The voices you have cloned. Use them anywhere you can type words — Text to Audio, or Lip Sync Pro."
            className="px-0"
          />
        </header>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <h2 className={cn("font-bold tracking-[-0.01em]", compact ? "text-[15px]" : "text-[17px]")}>Your voices</h2>
        {state.status === "ready" ? (
          <p className="text-[11.5px] tabular-nums text-muted-foreground">
            {state.slots.used} of {state.slots.total} {state.slots.total === 1 ? "slot" : "slots"} used
          </p>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <div className="mt-3 space-y-2" aria-busy="true" aria-label="Loading your voices">
          {[0, 1].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-[1.25rem] bg-secondary/60" />
          ))}
        </div>
      ) : state.status === "error" ? (
        <p className="mt-3 rounded-2xl bg-rose-500/10 px-3.5 py-2.5 text-[12.5px] text-rose-700 dark:text-rose-300">
          {state.message}{" "}
          <button type="button" onClick={() => void load()} className="font-semibold underline underline-offset-2">
            Try again
          </button>
        </p>
      ) : state.voices.length === 0 ? (
        <div className="mt-3 rounded-[1.25rem] border border-dashed border-border px-4 py-8 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
            <Mic className="h-5 w-5" aria-hidden />
          </span>
          <p className="mt-3 text-[14px] font-semibold">No voices yet</p>
          <p className="mx-auto mt-1 max-w-xs text-[12.5px] leading-relaxed text-muted-foreground">Clone a voice you own and it will be here, ready to speak anything you type.</p>
          <Link href={cloneHref} className="ai-cta mt-4 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-foreground px-5 text-[14px] font-bold text-background">
            <Plus className="h-4 w-4" aria-hidden /> Clone a voice
          </Link>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {state.voices.map((voice) => (
            <li key={voice.id} className={cn("rounded-[1.25rem] border border-border/70 bg-card p-3.5", busy === voice.id && "opacity-60")}>
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Mic className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-bold tracking-[-0.01em]">{voice.name}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                    {voice.describedAs ? `${voice.describedAs} · ` : ""}
                    {voice.sampleCount} recording{voice.sampleCount === 1 ? "" : "s"}
                    {voice.sampleSeconds ? ` · ${Math.round(voice.sampleSeconds)} s` : ""} · {new Date(voice.createdAt).toLocaleDateString()}
                    {voice.lastUsedAt ? ` · used ${new Date(voice.lastUsedAt).toLocaleDateString()}` : ""}
                  </p>
                  {voice.description ? <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">{voice.description}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => void rename(voice)} aria-label={`Rename ${voice.name}`} className="grid h-9 w-9 place-items-center rounded-full border border-border text-muted-foreground">
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button type="button" onClick={() => void remove(voice)} aria-label={`Delete ${voice.name}`} className="grid h-9 w-9 place-items-center rounded-full border border-border text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
              {voice.hasPreview ? <VoiceSamplePlayer cloneId={voice.id} className="mt-3" /> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`${ttaHref}?voice=${encodeURIComponent(`clone:${voice.id}`)}`}
                  onClick={() => track("voice_clone_reused", { to: "text_to_audio" })}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[12px] font-bold text-background"
                >
                  <Type className="h-3.5 w-3.5" aria-hidden /> Make audio
                </Link>
                <Link
                  href={`${lipSyncHref}?voice=${encodeURIComponent(`clone:${voice.id}`)}`}
                  onClick={() => track("voice_clone_reused", { to: "lip_sync" })}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-border px-3.5 text-[12px] font-semibold"
                >
                  <AudioLines className="h-3.5 w-3.5" aria-hidden /> Lip Sync Pro
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {state.status === "ready" && state.voices.length > 0 ? (
        <p className="mt-4 flex items-start justify-center gap-1.5 text-center text-[11px] leading-relaxed text-muted-foreground/75">
          <ShieldCheck className="mt-[1px] h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
          <span>You confirmed you hold the rights to each of these voices. Deleting one removes it everywhere.</span>
        </p>
      ) : null}
    </div>
  );
}
