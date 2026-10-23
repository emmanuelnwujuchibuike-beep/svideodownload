"use client";

import { useEffect, useRef, useState } from "react";

import { firstStage, promoStages, type AiPromo, type PromoStage } from "@/lib/ai/promo/config";
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
  /*
    🔴 MEDIA FIRST, AT ONCE (owner, 2026-10-07: "it should be like the wallpaper
    button"). The Wallpapers tile opens on a picture; this one opened on its
    own intro after a delay, so the media arrived after the visitor had moved
    on. Now it opens on the before/after pair (a picture paints at once), else
    the clip, and the intro takes its turn in the loop after them. No opening
    delay: the admin's "start after" is no longer applied.
  */
  const [stage, setStage] = useState<PromoStage>(() => firstStage(promo));
  // both pictures decoded — until then the intro stays up, never a black box
  const [pairLoaded, setPairLoaded] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [lite, setLite] = useState(false);
  /*
    🔴 iOS (owner, 2026-10-06: "The landing video is not showing"). iOS Safari
    IGNORES preload="auto" — it downloads nothing until play() — so a clip
    judged by readyState was never "ready" and its stage was skipped every
    time on an iPhone. Now: the clip is warmed with a muted play-then-pause
    during the opening delay (iOS allows that, and it makes it buffer); on its
    turn it is always asked to play; its layer shows only once it IS playing,
    so the intro stays up meanwhile (never a black box); and it is skipped only
    when it cannot play at all (Low Power Mode blocks autoplay).
  */
  const [clipPlaying, setClipPlaying] = useState(false);
  const [clipBlocked, setClipBlocked] = useState(false);
  /*
    🔴 THE CLIP WAITS FOR THE PAGE (owner, 2026-10-22: "the landing page takes ages to load …
    each time I go back to the browser it loads afresh"). A whole MP4 with preload="auto" and a
    warm-up play started at hydration — the largest file on the landing, competing on a phone
    connection with the page's own scripts. And a decoded clip held while the tab sat in the
    background is the memory iOS reclaims by discarding the tab, so coming back rebuilt the page.
    Now the pictures still paint at once; the clip mounts after the page's `load` (plus an idle
    moment) and is unmounted while the tab is hidden, mounted again on return from HTTP cache.
  */
  const [armed, setArmed] = useState(false);
  const stageRef = useRef<PromoStage>(stage);
  stageRef.current = stage;

  useEffect(() => {
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => setArmed(true), 1200);
    };
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    return () => {
      window.removeEventListener("load", arm);
      window.clearTimeout(timer);
    };
  }, []);

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
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const wantsClip = !!promo.video?.enabled && !lite && !clipBlocked;
  // the element exists only once the page has loaded and while the tab is visible (see `armed`)
  const useClip = wantsClip && armed && tabVisible;

  useEffect(() => {
    const v = video.current;
    // a clip on its own turn simply plays (the stage effect below); otherwise it is warmed for its turn
    if (!v || !useClip || reduced || stageRef.current === "video") return;
    let warmed = false;
    const onPlaying = () => {
      if (warmed) return;
      warmed = true;
      v.pause();
      v.currentTime = 0;
    };
    v.addEventListener("playing", onPlaying, { once: true });
    v.play().catch(() => setClipBlocked(true));
    return () => v.removeEventListener("playing", onPlaying);
    // each time the element mounts — after load, and again after the tab comes back
  }, [useClip, reduced]);
  // `wantsClip`, not `useClip`: a clip that is not mounted yet keeps its turn (the intro shows meanwhile)
  const stages = promoStages(promo).filter((s) => s !== "video" || wantsClip || !!promo.video?.poster);
  const running = onScreen && tabVisible && stages.length > 1;

  // the cycle: a single timeout for the current stage; paused = no timer, stage kept
  useEffect(() => {
    if (!running) return;
    const seconds = stage === "intro" ? promo.timing.intro : stage === "video" ? promo.timing.video : promo.timing.image;
    const t = setTimeout(() => {
      const next = stages[(stages.indexOf(stage) + 1) % stages.length] ?? "intro";
      // a clip that is not ready on its turn is skipped, never shown as a black box
      if (next === "video" && !useClip && !promo.video?.poster) {
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
    if (!v) {
      setClipPlaying(false);
      return;
    }
    if (running && stage === "video" && !reduced) {
      v.play().catch(() => setClipBlocked(true));
    } else {
      v.pause();
      setClipPlaying(false);
    }
  }, [running, stage, reduced, useClip]);

  const fade = reduced ? "" : "transition-opacity duration-500";
  return (
    <div ref={root} aria-hidden className="pointer-events-none absolute inset-0 z-[2] overflow-hidden rounded-[inherit]">
      {promo.video && stages.includes("video") ? (
        <div className={cn("absolute inset-0 bg-black", fade, stage === "video" && (clipPlaying || !!promo.video.poster) ? "opacity-100" : "opacity-0")}>
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
              // mounted only after the page's load — see `armed`
              preload="auto"
              onPlaying={() => stage === "video" && setClipPlaying(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : null}
          <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white ring-1 ring-inset ring-white/20">
            Frenz AI
          </span>
        </div>
      ) : null}
      {promo.image && stages.includes("image") ? (
        <div className={cn("absolute inset-0 grid grid-cols-2 bg-black", fade, stage === "image" && pairLoaded >= 2 ? "opacity-100" : "opacity-0")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={promo.image.before} alt="" decoding="async" fetchPriority="low" onLoad={() => setPairLoaded((n) => n + 1)} className="h-full w-full object-cover" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={promo.image.after} alt="" decoding="async" fetchPriority="low" onLoad={() => setPairLoaded((n) => n + 1)} className="h-full w-full object-cover" />
          <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-white/90 shadow-[0_0_10px_rgba(255,255,255,0.7)]" />
          <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">Original</span>
          <span className="absolute bottom-2 right-2 rounded-full bg-indigo-600/90 px-2 py-0.5 text-[10px] font-semibold text-white">Frenz AI</span>
        </div>
      ) : null}
    </div>
  );
}
