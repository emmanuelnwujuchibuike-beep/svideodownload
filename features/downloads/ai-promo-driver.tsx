"use client";

import { useEffect, useRef, useState } from "react";

import { promoStages, type AiPromo, type PromoStage } from "@/lib/ai/promo/config";
import { cn } from "@/lib/utils";

/**
 * Plays the landing promotion inside the Frenz AI tile (Brief C §3–§5, §10–§13).
 *
 * intro (the tile underneath, untouched) → the clip → the before/after pair →
 * intro → … — each stage a layer over the tile that fades with opacity only.
 *
 * 🔴 Owner, 2026-10-06: "it delays and it reloads each time the pages opens or
 * when the page make any movement". Two causes, both fixed here:
 *   · it paused whenever HALF the tile left the screen (any scroll, any shift)
 *     and on pausing it RESET to the intro and UNMOUNTED the clip — so every
 *     resume started over and re-buffered. Now it pauses only when the tile is
 *     wholly off screen, and resumes the stage it was on; the clip is loaded
 *     ONCE and only paused, never removed.
 *   · the clip was first asked for just before its turn. It now warms up during
 *     the opening delay, and a clip that still is not ready on its turn is
 *     skipped rather than shown as a black box.
 *
 * Reduced motion: no autoplay (the poster or the next stage stands in), no fade.
 * A slow / data-saving connection never downloads the clip. Layers are
 * `pointer-events-none`: the tile stays one link to /ai.
 */
export function AiPromoDriver({ promo }: { promo: AiPromo }) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  const [started, setStarted] = useState(false);
  const [stage, setStage] = useState<PromoStage>("intro");
  const [reduced, setReduced] = useState(false);
  const [lite, setLite] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    setLite(!!c && (c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g"));
    const el = root.current?.parentElement;
    if (!el) return;
    // any part of the tile on screen counts — a scroll or a layout nudge must not stop it
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting), { threshold: 0 });
    io.observe(el);
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    // the opening delay runs while the clip warms up below
    const t = setTimeout(() => setStarted(true), promo.timing.delay * 1000);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      clearTimeout(t);
    };
  }, [promo.timing.delay]);

  const useClip = !!promo.video?.enabled && !lite;
  const stages = promoStages(promo).filter((s) => s !== "video" || useClip || !!promo.video?.poster);
  const running = started && onScreen && tabVisible && stages.length > 1;

  // the cycle: a single timeout for the current stage; paused = no timer, stage kept
  useEffect(() => {
    if (!running) return;
    const seconds = stage === "intro" ? promo.timing.intro : stage === "video" ? promo.timing.video : promo.timing.image;
    const t = setTimeout(() => {
      const next = stages[(stages.indexOf(stage) + 1) % stages.length] ?? "intro";
      // a clip that is not ready on its turn is skipped, never shown as a black box
      if (next === "video" && useClip && !promo.video?.poster && (video.current?.readyState ?? 0) < 2) {
        setStage(stages[(stages.indexOf(next) + 1) % stages.length] ?? "intro");
        return;
      }
      setStage(next);
    }, seconds * 1000);
    return () => clearTimeout(t);
    // `stages` derives from props that do not change while mounted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, stage]);

  // play only on its own stage, while running; otherwise paused — never unmounted
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (running && stage === "video" && !reduced) {
      v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  }, [running, stage, reduced]);

  const fade = reduced ? "" : "transition-opacity duration-500";
  return (
    <div ref={root} aria-hidden className="pointer-events-none absolute inset-0 z-[2] overflow-hidden rounded-[inherit]">
      {promo.video && stages.includes("video") ? (
        <div className={cn("absolute inset-0 bg-black", fade, stage === "video" ? "opacity-100" : "opacity-0")}>
          {promo.video.poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={promo.video.poster} alt="" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
          {useClip ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              ref={video}
              src={promo.video.url}
              poster={promo.video.poster ?? undefined}
              muted
              playsInline
              loop
              // loaded once, during the opening delay, then only played and paused
              preload="auto"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
          <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white ring-1 ring-inset ring-white/20">
            Frenz AI
          </span>
        </div>
      ) : null}
      {promo.image && stages.includes("image") ? (
        <div className={cn("absolute inset-0 grid grid-cols-2 bg-black", fade, stage === "image" ? "opacity-100" : "opacity-0")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={promo.image.before} alt="" decoding="async" className="h-full w-full object-cover" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={promo.image.after} alt="" decoding="async" className="h-full w-full object-cover" />
          <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-white/90 shadow-[0_0_10px_rgba(255,255,255,0.7)]" />
          <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">Original</span>
          <span className="absolute bottom-2 right-2 rounded-full bg-indigo-600/90 px-2 py-0.5 text-[10px] font-semibold text-white">Frenz AI</span>
        </div>
      ) : null}
    </div>
  );
}
