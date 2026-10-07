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
 * Runs ONLY while the tile is on screen and the tab is visible; off-screen the
 * clip is paused and unmounted, the cycle stops, and it resumes at the intro
 * when it comes back. Reduced motion: no autoplay — the poster stands in, and
 * stages change without a fade. A slow or data-saving connection gets the
 * poster too, never a spinner; no poster means the video stage is skipped. A
 * clip that has not started within 1.5 s shows its poster and the loop moves on.
 *
 * Layers are `pointer-events-none`: the tile stays one link to /ai.
 */
export function AiPromoDriver({ promo }: { promo: AiPromo }) {
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const [stage, setStage] = useState<PromoStage>("intro");
  const [reduced, setReduced] = useState(false);
  const [lite, setLite] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    setLite(!!c && (c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g"));
    const el = root.current?.parentElement;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e && e.isIntersecting && e.intersectionRatio >= 0.5), { threshold: [0, 0.5] });
    io.observe(el);
    const onVis = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // The stages this visitor can actually see: a video stage needs either playback or a poster.
  const playable = promoStages(promo).filter((s) => s !== "video" || !lite || !!promo.video?.poster);
  const running = visible && tabVisible && playable.length > 1;

  useEffect(() => {
    if (!running) {
      setStage("intro");
      return;
    }
    const seconds = stage === "intro" ? promo.timing.intro : stage === "video" ? promo.timing.video : promo.timing.image;
    const t = setTimeout(() => {
      const i = playable.indexOf(stage);
      setStage(playable[(i + 1) % playable.length] ?? "intro");
    }, seconds * 1000);
    return () => clearTimeout(t);
    // `playable` is derived from props that do not change while mounted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, stage]);

  const fade = reduced ? "" : "transition-opacity duration-500";
  return (
    <div ref={root} aria-hidden className="pointer-events-none absolute inset-0 z-[2] overflow-hidden rounded-[inherit]">
      {promo.video && playable.includes("video") ? (
        <div className={cn("absolute inset-0 bg-black", fade, stage === "video" ? "opacity-100" : "opacity-0")}>
          {/* mounted only around its own stage — never downloading while the visitor reads something else */}
          {running && (stage === "video" || stage === "intro") ? (
            <PromoClip video={promo.video} play={stage === "video" && !reduced && !lite} />
          ) : null}
          <Chip>Frenz AI</Chip>
        </div>
      ) : null}
      {promo.image && playable.includes("image") ? (
        <div className={cn("absolute inset-0 grid grid-cols-2 bg-black", fade, stage === "image" ? "opacity-100" : "opacity-0")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={promo.image.before} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={promo.image.after} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-white/90 shadow-[0_0_10px_rgba(255,255,255,0.7)]" />
          <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">Original</span>
          <span className="absolute bottom-2 right-2 rounded-full bg-indigo-600/90 px-2 py-0.5 text-[10px] font-semibold text-white">Frenz AI</span>
        </div>
      ) : null}
    </div>
  );
}

function PromoClip({ video, play }: { video: NonNullable<AiPromo["video"]>; play: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (!play) {
      v.pause();
      return;
    }
    setStalled(false);
    // A clip that cannot start promptly keeps its poster rather than showing a spinner (§10).
    const guard = setTimeout(() => setStalled(true), 1500);
    v.play().then(() => clearTimeout(guard)).catch(() => setStalled(true));
    return () => clearTimeout(guard);
  }, [play]);

  return (
    <>
      {video.poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.poster} alt="" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={ref}
        src={video.url}
        poster={video.poster ?? undefined}
        muted
        playsInline
        loop
        // fetched only when this element exists, which is only around its own stage
        preload={play ? "auto" : "metadata"}
        className={cn("absolute inset-0 h-full w-full object-cover", stalled && "opacity-0")}
      />
    </>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white ring-1 ring-inset ring-white/20">
      {children}
    </span>
  );
}
