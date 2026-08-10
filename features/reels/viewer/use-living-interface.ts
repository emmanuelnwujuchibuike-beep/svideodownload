"use client";

import { useEffect, useRef, useState } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LIVING INTERFACE™ (Feature 15, Part 1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "The UI subtly adapts to the video's colour palette — ocean videos get cool
 *  blue highlights, sunset videos a warm amber glow, night videos deep purple,
 *  forest videos soft emerald. Subtle, elegant, performance optimized."
 *
 * This is the single most identifiable thing in the viewer: no other short-video
 * platform tints its chrome from the content. It is also the one most capable of
 * wrecking the experience if built carelessly, so the constraints below are not
 * optional decoration — they are what makes it shippable.
 *
 * ── It also powers Smart UI, and that is why it returns luminance ───────────
 *
 * The spec asks separately for "bright videos → darker overlays, dark videos →
 * more text contrast". That is the SAME measurement as the palette, so it is one
 * pass producing both. Two independent samplers would eventually disagree and
 * produce a frame that is simultaneously "bright" and "dark".
 *
 * ── How it samples, and why it is cheap ────────────────────────────────────
 *
 * `drawImage` the video into a 16×16 offscreen canvas and average it. That is
 * 256 pixels, not two million: the GPU does the downscale, and the read-back is
 * 1KB. Sampling at native resolution would be a multi-megabyte `getImageData`
 * per tick and would drop frames on exactly the mid-range phones this project
 * cares about.
 *
 * 🔴 Sampling is CAPPED and DEMAND-DRIVEN, never a render loop:
 *
 *  • Only the ACTIVE reel samples. A deck has several cards mounted; sampling
 *    all of them would multiply the cost by the preload depth for zero benefit,
 *    since only one is visible.
 *  • It samples a handful of times shortly after play begins and then STOPS.
 *    A colour that keeps drifting is a distraction — the point is for the UI to
 *    take on the video's character, not to strobe along with every cut. This
 *    also means the cost is bounded per reel rather than per second of watching.
 *  • It never runs while the tab is hidden, and never under reduced-motion.
 *  • The whole thing is wrapped in try/catch and fails to NEUTRAL. A cross-origin
 *    frame taints the canvas and throws on read — which is not an edge case here,
 *    because reels can be served from R2 or a source CDN. Tainted simply means no
 *    tint, and the viewer looks exactly like it did before this feature existed.
 *
 * ── Why the result is deliberately desaturated ─────────────────────────────
 *
 * The extracted colour is pushed toward a fixed lightness and a capped
 * saturation before use. A raw dominant colour from video is frequently a
 * blown-out skin tone or a saturated brand red, and letting that drive the
 * accent produces chrome that looks broken rather than themed. Clamping is what
 * makes it read as "the UI is lit by the video" rather than "the UI changed
 * colour".
 */

export interface LivingPalette {
  /** `H S% L%` channels, ready for `hsl(var(--reel-accent))`. Null = neutral. */
  accent: string | null;
  /** 0 (black) → 1 (white). Drives the Smart UI contrast floor. */
  luminance: number;
}

const NEUTRAL: LivingPalette = { accent: null, luminance: 0.35 };

/** How many samples before we settle. */
const SAMPLES = 4;
/** Gap between samples, ms. Spread across the opening seconds of the clip. */
const SAMPLE_EVERY_MS = 700;
/** Square edge of the sampling canvas. 16×16 = 256 pixels to average. */
const N = 16;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

export function useLivingInterface(
  video: HTMLVideoElement | null,
  /** Only the ACTIVE card samples — see the note above. */
  active: boolean,
  /** Owner/user switch. When false this is inert and returns neutral. */
  enabled = true,
): LivingPalette {
  const [palette, setPalette] = useState<LivingPalette>(NEUTRAL);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled || !active || !video) {
      setPalette(NEUTRAL);
      return;
    }
    // Reduced motion means "stop things changing under me". A chrome colour that
    // shifts mid-watch is exactly that, so the feature turns itself off rather
    // than merely animating the change more slowly.
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPalette(NEUTRAL);
      return;
    }

    let taken = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const sample = () => {
      if (cancelled) return;
      // Never sample a hidden tab: the frame is stale and the work is pure waste.
      if (document.hidden) {
        timer = setTimeout(sample, SAMPLE_EVERY_MS);
        return;
      }
      try {
        // `readyState < 2` means there is no current frame to draw yet.
        if (video.readyState < 2 || video.videoWidth === 0) {
          timer = setTimeout(sample, SAMPLE_EVERY_MS);
          return;
        }
        if (!canvas.current) {
          canvas.current = document.createElement("canvas");
          canvas.current.width = N;
          canvas.current.height = N;
        }
        const ctx = canvas.current.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, N, N);
        // Throws on a cross-origin (tainted) canvas — caught below, neutral.
        const { data } = ctx.getImageData(0, 0, N, N);

        let r = 0;
        let g = 0;
        let b = 0;
        let weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i]!;
          const pg = data[i + 1]!;
          const pb = data[i + 2]!;
          /*
            Weight by saturation.

            A flat average of a video frame is almost always a muddy grey-brown,
            because most of a frame is midtones. Weighting toward the more
            colourful pixels is what actually finds "the ocean one is blue" —
            the blue is a minority of the pixels but it is what the video reads
            as. Grey pixels still contribute a little (the +0.15 floor) so a
            genuinely monochrome video does not get its accent decided by three
            stray coloured pixels.
          */
          const mx = Math.max(pr, pg, pb);
          const mn = Math.min(pr, pg, pb);
          const sat = mx === 0 ? 0 : (mx - mn) / mx;
          const w = sat + 0.15;
          r += pr * w;
          g += pg * w;
          b += pb * w;
          weight += w;
        }
        if (weight === 0) return;
        r /= weight;
        g /= weight;
        b /= weight;

        // Luminance uses a FLAT average (not the saturation-weighted one) —
        // it answers "how bright is this frame", which is about all the pixels,
        // not about the colourful ones.
        let lum = 0;
        for (let i = 0; i < data.length; i += 4) {
          lum += (0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255;
        }
        lum /= data.length / 4;

        const [h, s] = rgbToHsl(r, g, b);
        /*
          Clamped hard, for the reason in the header: a raw dominant colour is
          often a blown skin tone or a saturated brand red, and using it directly
          makes the chrome look broken. Saturation caps at 62% and lightness is
          PINNED to 62% regardless of the source, so the accent is always a
          colour that white text and a glass surface can live with.
        */
        const sat = Math.min(0.62, Math.max(0.28, s));
        const accent = `${Math.round(h)} ${Math.round(sat * 100)}% 62%`;

        if (!cancelled) setPalette({ accent, luminance: lum });
      } catch {
        /*
          Tainted canvas (cross-origin frame), no 2d context, or a decode that is
          not ready. All of them mean the same thing: we cannot know the colour.
          Fail to neutral — the viewer is fully functional without a tint, and a
          wrong tint is worse than none.
        */
        if (!cancelled) setPalette(NEUTRAL);
        return;
      }
      taken += 1;
      // Settle. See the header: a colour that keeps drifting is a distraction,
      // and stopping is what bounds the cost per reel.
      if (taken < SAMPLES) timer = setTimeout(sample, SAMPLE_EVERY_MS);
    };

    // First sample is delayed: at t=0 a video is usually still on its poster or
    // a black lead-in frame, which would theme the whole reel from nothing.
    timer = setTimeout(sample, 350);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [video, active, enabled]);

  return palette;
}
