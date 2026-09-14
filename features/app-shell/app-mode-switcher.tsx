"use client";

import { Check, Download, LayoutGrid, SlidersHorizontal } from "lucide-react";
import type { ComponentType } from "react";

import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

import { setAppMode, useAppMode } from "./use-app-mode";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EXPERIENCE MODE — Downloader ⇄ Full Bleed, on the owner's own profile
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-13: "Upgrade the experience mode section and card to be
 * more premium and professional." It is one of the three things the profile
 * still renders in the document (hero, this, the grid), so it earns its
 * place: a glass card with a glossy tile and an eyebrow, two large option
 * tiles that read as a real choice — the active one lifted on a brand ring
 * with a check, the other calm — and one honest sentence about what the
 * chosen mode can and cannot do.
 *
 * Plain CSS, no motion library, one `setAppMode` on tap: the card costs the
 * profile a few hundred bytes of markup and nothing on the wire.
 */
export function AppModeSwitcher({ className }: { className?: string }) {
  const mode = useAppMode();
  return (
    <section
      aria-labelledby="frenz-mode-title"
      className={cn(
        "relative overflow-hidden rounded-3xl border border-border/60 bg-card p-4 sm:p-5",
        "shadow-[0_1px_0_rgb(255_255_255/0.7)_inset,0_18px_40px_-28px_rgb(15_23_42/0.45)] dark:shadow-[0_1px_0_rgb(255_255_255/0.06)_inset,0_18px_40px_-28px_rgb(0_0_0/0.7)]",
        className,
      )}
    >
      {/*
        A whisper of brand light in the corner — decoration, not a message.
        🔴 Painted as an in-bounds gradient, NOT a blurred child hanging past
        the edge: Safari does not clip a blurred, overflowing child to a
        rounded parent, and the corner rendered square (owner, 2026-09-14
        screenshot, "the edge gradient not have a border radius").
      */}
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(70%_60%_at_100%_0%,rgb(99_102_241/0.14),transparent_70%)]" />

      <div className="relative flex items-center gap-3">
        {/* Colourless, 3D (owner, 2026-09-14: "like Snapchat icons") — .frenz-tile-3d in globals.css. */}
        <span aria-hidden className="frenz-tile-3d relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px]">
          <SlidersHorizontal className="relative h-[20px] w-[20px]" strokeWidth={2.4} />
        </span>
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Experience mode</p>
          <h3 id="frenz-mode-title" className="mt-0.5 text-[15px] font-bold leading-tight tracking-tight">
            How Frenz opens for you
          </h3>
        </div>
      </div>

      <div role="radiogroup" aria-label="Experience mode" className="relative mt-4 grid grid-cols-2 gap-2.5">
        <ModeTile
          active={mode === "downloader"}
          onSelect={() => {
            if (mode === "downloader") return;
            haptic("selection");
            setAppMode("downloader");
          }}
          icon={Download}
          tint={["#0EA5E9", "#2563FF"]}
          title="Downloader"
          desc="Downloads and your data, focused"
        />
        <ModeTile
          active={mode === "full"}
          onSelect={() => {
            if (mode === "full") return;
            haptic("selection");
            setAppMode("full");
          }}
          icon={LayoutGrid}
          tint={["#6D5CFF", "#EC4899"]}
          title="Full Bleed"
          desc="Everything — social and downloads"
        />
      </div>

      <p className="relative mt-3 text-[12px] leading-relaxed text-muted-foreground">
        {mode === "downloader"
          ? "You can share downloads and get likes, views and comments. Chatting and uploading from your gallery need Full Bleed."
          : "The complete Frenz experience — social features and downloads together. Switch any time; nothing is lost."}
      </p>
    </section>
  );
}

function ModeTile({
  active,
  onSelect,
  icon: Icon,
  tint,
  title,
  desc,
}: {
  active: boolean;
  onSelect: () => void;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  tint: [string, string];
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "relative flex min-h-[112px] flex-col items-start gap-2 rounded-2xl border p-3.5 text-left transition",
        "active:scale-[0.98] motion-safe:hover:-translate-y-0.5",
        active
          ? "border-transparent bg-background shadow-[0_0_0_2px_rgb(99_102_241/0.55),0_14px_30px_-20px_rgb(99_102_241/0.6)]"
          : "border-border/60 bg-secondary/40 hover:border-foreground/15 hover:bg-secondary/60",
      )}
    >
      {active ? (
        <span aria-hidden className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-fuchsia-500 text-white shadow-sm">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : null}
      <span
        aria-hidden
        className={cn("relative flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-sm transition", !active && "opacity-80 saturate-[0.85]")}
        style={{ background: `linear-gradient(135deg, ${tint[0]}, ${tint[1]})` }}
      >
        <span className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-b from-white/30 to-transparent" />
        <Icon className="relative h-[18px] w-[18px]" strokeWidth={2.25} />
      </span>
      <span className="mt-auto">
        <span className="block text-[14px] font-bold leading-tight">{title}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}
