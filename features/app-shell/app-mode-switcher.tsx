"use client";

import { Check, Download, LayoutGrid } from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";

import { setAppMode, useAppMode } from "./use-app-mode";

/**
 * The Downloader ⇄ Full Bleed switcher (owner) — shown on the member's OWN profile.
 * "Full Bleed" is the complete site (the default); "Downloader" makes the
 * personalized landing the home and gates chat + gallery uploads behind a switch
 * back. The profile page itself is identical in both modes.
 */
export function AppModeSwitcher({ className }: { className?: string }) {
  const mode = useAppMode();
  return (
    <section className={cn("rounded-3xl border border-border/60 bg-card p-4 shadow-soft sm:p-5", className)}>
      <h3 className="text-sm font-bold tracking-tight">Experience mode</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Choose how Frenz opens for you. Switch anytime.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <ModeCard
          active={mode === "downloader"}
          onClick={() => mode !== "downloader" && setAppMode("downloader")}
          icon={Download}
          title="Downloader"
          desc="Downloads & your data, focused"
        />
        <ModeCard
          active={mode === "full"}
          onClick={() => mode !== "full" && setAppMode("full")}
          icon={LayoutGrid}
          title="Full Bleed"
          desc="Everything — social + downloads"
        />
      </div>
      <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {mode === "downloader"
          ? "You can share downloads and get likes, views and comments. Chatting and uploading from your gallery need Full Bleed."
          : "The complete Frenz experience — social features and downloads together."}
      </p>
    </section>
  );
}

function ModeCard({
  active,
  onClick,
  icon: Icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition active:scale-[0.98]",
        active
          ? "border-primary/50 bg-primary/5 ring-2 ring-primary/30"
          : "border-border/60 bg-secondary/40 hover:border-foreground/15 hover:bg-secondary/60",
      )}
    >
      {active ? (
        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : null}
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", active ? "bg-gradient-to-br from-blue-600 to-violet-600 text-white" : "bg-background text-muted-foreground")}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="mt-1 text-sm font-bold">{title}</span>
      <span className="text-[11px] leading-tight text-muted-foreground">{desc}</span>
    </button>
  );
}
