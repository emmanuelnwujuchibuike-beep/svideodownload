import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE STILL — one real frame, shared by every Frenz AI mock-up
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-08: "this before and after card looks too unprofessional, pick
 * a matching image from the wallpaper gallery and use it… the progress
 * animation glass card is too empty, pick an image from the wallpaper gallery
 * and use, note they shouldnt break any performance or cause overheating."
 *
 * The drawn CSS landscape it replaces was honest about being cheap and looked
 * it. A real photograph is the difference between a diagram of the product and
 * a picture of it working.
 *
 * ── 🔴 ONE IMAGE, EVERYWHERE, ON PURPOSE ────────────────────────────────────
 *
 * The before/after card shows this twice and the progress card shows it once.
 * All three are the SAME url at the SAME rendered width, so the browser fetches
 * and decodes exactly one image for the whole feature and serves the rest from
 * cache. Three different wallpapers would have looked no better and cost three
 * downloads and three decodes on a phone.
 *
 * ── How it stays inside the performance rule ────────────────────────────────
 *
 * That rule has already been broken twice on this feature (25 backdrop-blur
 * layers, then nine simultaneous animations), so the numbers here are chosen
 * rather than assumed:
 *
 *   · `next/image`, so the 43 kB source is re-encoded to AVIF at the width it
 *     is actually displayed — a ~176px card gets a few kB, not 43;
 *   · `sizes` is a FIXED px value, not a viewport fraction. These cards are a
 *     fixed size at every breakpoint, and a `100vw`-shaped hint would make the
 *     optimizer serve a full-width variant for a thumbnail;
 *   · `quality={74}`, deliberately NOT the default 75. This project measured a
 *     landing LCP regression traced to `q=75` poisoning the optimizer's cache
 *     key; 74 and 76 return a much smaller AVIF from the same source;
 *   · no `priority`. It is decoration below the fold on both screens, so it
 *     must never compete with real content for bandwidth;
 *   · `alt=""` and `aria-hidden` on the frame — it illustrates, it does not
 *     inform, and a screen reader should skip it.
 *
 * It is a still, not a video. Nothing decodes per frame, nothing plays, and it
 * costs zero once painted — which is the whole reason the mock-ups use an image
 * rather than an actual `<video>`.
 */

/**
 * A published wallpaper from the owner's own gallery — 736x1448, 63 kB: a neon
 * mountain in teal and magenta on black.
 *
 * ── 🔴 CHOSEN BY LOOKING AT IT, NOT BY ITS CATEGORY ─────────────────────────
 *
 * The first pick was the smallest file in the "Nature" category, which turned
 * out to be a red shark. Rendered at 176px under the caption "This is an
 * amazing place to visit" it was comic, and it made the whole card look like a
 * mistake — which is exactly the "unprofessional" the owner was objecting to.
 * The category column is a label somebody typed; the only reliable way to
 * choose an image is to open it.
 *
 * This one earns its place four ways: it reads instantly as scenery so the
 * caption makes sense, its palette IS the Frenz AI palette (blue → violet →
 * magenta), it is dark enough that a white caption box has real contrast on it,
 * and it is portrait, which is the shape of the card and of the videos this
 * tool is for.
 *
 * Hard-coded rather than queried: these are decorative frames inside a mock-up,
 * and making two marketing surfaces depend on a database read — which could be
 * empty, slow, or return a landscape-cropped car — would trade a guaranteed
 * result for a variable one on the first screen of the feature.
 */
export const FRENZ_AI_STILL_URL =
  "https://wmimmsrtafazowjperog.supabase.co/storage/v1/object/public/wallpapers/curated/1785785472277-08khse.jpg";

/**
 * A SECOND frame, for the progress card only.
 *
 * Owner, 2026-09-08: "this progress card uses the same image as the ai welcome
 * page, use a different image for the progress card".
 *
 * 736x1448, 124 kB — a red-lit road tunnel cut into a snowy mountain: teal
 * shadows around one warm glowing arch.
 *
 * 🔴 CHOSEN AT THE SIZE IT IS ACTUALLY SHOWN, which is ~140px wide. That ruled
 * out more than it sounds. A photograph of an apartment block's lit windows —
 * striking at full size — collapsed into visual noise at that scale. A violet
 * gradient, the cheapest file of the lot at 30 kB and perfectly on-palette,
 * read as an empty placeholder, which is the exact complaint ("the progress
 * animation glass card is too empty") that put an image here in the first
 * place. This one holds ONE bright focal point dead centre, so it still reads
 * as a frame of real footage in a thumbnail.
 *
 * It is deliberately unlike the welcome still: warm where that one is cool, a
 * single light source where that one is a silhouette. Two frames that differ
 * only slightly look like the same picture failing to load twice.
 *
 * The extra fetch is real and bounded: one more image, on ONE screen, at 140px
 * through next/image — a few kB of AVIF, no priority, below the fold.
 */
export const FRENZ_AI_PROGRESS_STILL_URL =
  "https://wmimmsrtafazowjperog.supabase.co/storage/v1/object/public/wallpapers/curated/1785785470910-rlk78v.jpg";

export function FrenzAIStill({
  /** The CSS width this will actually occupy — drives the variant fetched. */
  sizes,
  className,
  /** "progress" uses the second frame; every other surface shares the first. */
  variant = "default",
}: {
  sizes: string;
  className?: string;
  variant?: "default" | "progress";
}) {
  return (
    <Image
      src={variant === "progress" ? FRENZ_AI_PROGRESS_STILL_URL : FRENZ_AI_STILL_URL}
      alt=""
      aria-hidden
      fill
      sizes={sizes}
      quality={74}
      className={cn("object-cover", className)}
    />
  );
}
