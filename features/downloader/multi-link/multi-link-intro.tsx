"use client";

import { ChevronDown, HelpCircle, Layers, Link2, Package, Shuffle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The Multi-Link block above the batch panel, rebuilt to the owner's reference
 * screenshot (`public/downloadandlanding arrangement.jpg`, 2026-08-25).
 *
 * Structure, top to bottom: heading with a "?" beside it, three capability
 * chips with icons, then the tappable "＋ Multiple Links" row carrying an
 * "Up to N" pill — all inside ONE card, matching the reference.
 *
 * ── Where the description went ────────────────────────────────────────────
 * It is not rendered at rest at all. Owner: "hide the multilink gray
 * description … it occupied a lot of space in hero section", then "no need for
 * the learn me there, you just put a question mark at the top of the multi
 * link H1 text". So the explanation lives behind the "?" and floats ABOVE the
 * layout when opened — the requirement was literally "so it doesnt occupy
 * space", and a block that expands in place occupies space by definition and
 * would push the paste box down, which is a layout shift on the page whose CLS
 * was once measured at 0.684.
 *
 * ── Where the daily allowance went ────────────────────────────────────────
 * Into the opened panel (`PlanStrip`, multi-link-panel.tsx). Owner: "put the
 * batch remaining to show after the plus multi link button is clicked". That
 * also removes the last reason the COLLAPSED card would need per-visitor data,
 * so nothing here waits on a request — see multi-link-button.tsx.
 */

const CHIPS = [
  { label: "Same platform", icon: Link2 },
  { label: "Mixed platforms", icon: Shuffle },
  { label: "Batch download", icon: Package },
] as const;

export function MultiLinkIntro({
  open,
  onToggle,
  sourceLimit,
  isPro,
  surface = "card",
}: {
  open: boolean;
  onToggle: () => void;
  sourceLimit: number;
  isPro: boolean;
  surface?: "hero" | "card";
}) {
  const onHero = surface === "hero";

  const [showDetail, setShowDetail] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss after 3s (owner). Hovering pauses it — reading the sentence
  // should not be a race against a timer.
  useEffect(() => {
    if (!showDetail) return;
    hideTimer.current = setTimeout(() => setShowDetail(false), 3000);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [showDetail]);

  return (
    <section
      aria-labelledby="multi-link-heading"
      className={cn(
        "mt-3 rounded-2xl border p-3 sm:p-4",
        onHero ? "border-white/15 bg-white/[0.06] text-white" : "border-border bg-card text-foreground",
      )}
    >
      {/* ── Heading + the "?" ──────────────────────────────────────────── */}
      <div className="relative flex items-start gap-2">
        <h3 id="multi-link-heading" className="text-balance text-base font-extrabold tracking-tight sm:text-lg">
          Download multiple links, all in one place.
        </h3>

        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          aria-expanded={showDetail}
          aria-controls="multi-link-detail"
          aria-label={showDetail ? "Hide what batch download does" : "What does this do?"}
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            showDetail
              ? "bg-primary text-primary-foreground"
              : onHero
                ? "text-white/60 hover:bg-white/10 hover:text-white"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          <HelpCircle aria-hidden className="h-4 w-4" />
        </button>

        {/*
          🔴 Centred through the LAYOUT (`inset-x-0 mx-auto`), never with
          `-translate-x-1/2` (owner, with a screenshot: "it opens the mockup in
          an unprofessional position" — it was hanging off the right edge).
          That class and `animate-fade-up` both write `transform`, and the
          animation wins: its keyframes end at `translateY(0)`, silently
          discarding the horizontal centring, so the card was positioned with
          its LEFT edge at the midpoint. Layout centring cannot collide with an
          animation because the two no longer touch the same property.
        */}
        {showDetail ? (
          <div
            id="multi-link-detail"
            role="status"
            aria-live="polite"
            onMouseEnter={() => {
              if (hideTimer.current) clearTimeout(hideTimer.current);
            }}
            onMouseLeave={() => setShowDetail(false)}
            className={cn(
              "animate-fade-up absolute inset-x-0 top-full z-20 mx-auto mt-2 w-full rounded-xl border p-3 text-left text-sm leading-relaxed shadow-luxury",
              onHero
                ? "border-white/15 bg-[#0b1020]/95 text-white/85 backdrop-blur"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            Add links from the same platform or mix different supported platforms into one batch.
            Fetch, choose what you want, and download everything together.
          </div>
        ) : null}
      </div>

      {/* ── Capability chips, with icons per the reference ─────────────── */}
      <ul className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {CHIPS.map(({ label, icon: Icon }) => (
          <li
            key={label}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium sm:text-xs",
              onHero
                ? "border-white/20 bg-white/[0.07] text-white/85"
                : "border-border/70 bg-background text-muted-foreground",
            )}
          >
            <Icon aria-hidden className="h-3.5 w-3.5 text-primary" />
            {label}
          </li>
        ))}
      </ul>

      {/* ── The control. The whole row is the button (§5 of the earlier
             brief) — on a phone that is the difference between a control you
             can hit and one you aim at. ─────────────────────────────────── */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="multi-link-panel"
        className={cn(
          "mt-2.5 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          onHero
            ? "border-white/20 bg-white/[0.07] hover:bg-white/[0.12]"
            : "border-border bg-background hover:border-primary/40 hover:bg-secondary/40",
          open && (onHero ? "border-white/35 bg-white/[0.12]" : "border-primary/50 bg-secondary/40"),
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
            onHero ? "bg-white/10 text-white" : "bg-secondary text-foreground",
          )}
        >
          <Layers aria-hidden className="h-4 w-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold">
            <span aria-hidden>＋</span> Multiple Links
          </span>
          <span className={cn("mt-0.5 block text-xs", onHero ? "text-white/70" : "text-muted-foreground")}>
            Add up to {sourceLimit} links at once
          </span>
        </span>

        {/* The "Up to N" pill from the reference. Carries the Pro tier when
            that is what the visitor has, so the same element answers "how many
            can I add" for both plans instead of two different affordances. */}
        <span
          className={cn(
            "shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold",
            onHero ? "bg-white/15 text-white" : "bg-primary/10 text-primary",
          )}
        >
          Up to {sourceLimit}
          {isPro ? " · PRO" : ""}
        </span>

        {/* Rotates on `transform` only, so it is composited. */}
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
            onHero ? "text-white/70" : "text-muted-foreground",
            open && "rotate-180",
          )}
        />
      </button>
    </section>
  );
}
