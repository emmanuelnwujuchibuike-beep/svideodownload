/**
 * The SERVER's recipe for a locked exclusive video's blurred clip (owner, 2026-10-29: "the 18+ and all exclusive should
 * auto play in the exclusive feed like normal feed but blurred on unsubscriber, nothing less than that").
 *
 * The same clip the creator's browser makes at publish (lib/media/make-blur-clip.ts): the first BLUR_CLIP_SECONDS
 * drawn BLUR_CLIP_WIDTH pixels wide, blurred, at FPS — the detail is destroyed before anything is stored, so the clip
 * can be public. Made here on the worker (server/services/sub-blur-clip-service.ts) for every locked video that has
 * none: posts from before every video got one, and the ones a browser could not make (no MediaRecorder, a tainted
 * canvas). Always H.264 baseline in MP4 with faststart — the one format every iPhone plays — never WebM.
 *
 * 🔴 RECIPE 2 (owner, 2026-10-30: "the video been blurred is lagging low quality inside the blur and users can see the
 * lagging low quality"). Recipe 1 stored the 24 px frames as they were, at 12 fps: the phone scaled each clip pixel up
 * to ~16 screen pixels, so its blocks (and H.264's) showed through the CSS blur, and the motion stepped. Now:
 *   · the detail is still destroyed at `width` px (24, or 48 on Light) — the gate is unchanged;
 *   · those frames are then enlarged BLUR_CLIP_UPSCALE× and Gaussian-blurred before encoding, so the stored clip is a
 *     smooth gradient (no detail is added: every output pixel comes from the tiny frame), and no block can show;
 *   · 24 fps, so the movement is fluid.
 * 🔴 RECIPE 3 (owner, 2026-10-30, later: "the main issue is the blurred auto is lagging on low quality"). Measured on
 * production: the clips playing were browser recordings — 24×52 px, or 96×168 at a VARIABLE frame rate — and every
 * clip was a 4-second loop, so the movement stuttered and visibly repeated. Recipe 3 keeps the gate exactly where it was
 * (the detail is still destroyed at `width` px) and only makes the playback smooth: 30 fps at a constant rate, 6 s
 * before it loops, and enlarged 8× (192 px wide at Medium) with the Gaussian baked in, so nothing is left for the phone
 * to stretch. Recipe-2 clips are remade once like any other.
 * Worker clips are stored under BLUR_CLIP_MARK; a clip without it (an older recipe, or a browser recording) is remade by
 * the worker once (CLIP_NEEDS_WORK_FILTER).
 *
 * Pure: arguments only, so a test can read the exact command.
 */
export const BLUR_CLIP_WIDTH = 24;
export const BLUR_CLIP_SECONDS = 6;
export const BLUR_CLIP_FPS = 30;
/** The tiny frames are enlarged this much, smoothly, before encoding — the stored clip carries no blocks. */
export const BLUR_CLIP_UPSCALE = 8;
/** In the key of every clip the worker makes with the current recipe: `sub-blur/v3/<post>/<idx>-<t>.mp4`. */
export const BLUR_CLIP_MARK = "/sub-blur/v3/";
/** A real clip (≤ 256 px of smooth gradient, 4 s) is well under 200 KB; anything near this is not one. */
export const BLUR_CLIP_MAX_BYTES = 512 * 1024;

/** Where the worker stores a clip it made with the current recipe (public bucket). */
export function blurClipKey(postId: string, idx: number, stamp: string): string {
  return `${BLUR_CLIP_MARK.slice(1)}${postId}/${idx}-${stamp}.mp4`;
}

/** `width`: the post's blur level decides it (lib/sub/blur-level.ts BLUR_CLIP_WIDTH_FOR) — 24 px unless it is Light. */
export function buildBlurClipArgs(input: string, output: string, width: number = BLUR_CLIP_WIDTH): string[] {
  const w = Math.max(8, Math.min(64, Math.round(width)));
  const big = w * BLUR_CLIP_UPSCALE;
  // a Gaussian about half a source pixel wide at the enlarged size: the tiny frame's pixels melt into each other
  const sigma = (BLUR_CLIP_UPSCALE * 0.6).toFixed(1);
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    // before -i: only the first seconds are ever READ (ranged requests on the five-minute link), never the whole file
    "-t",
    String(BLUR_CLIP_SECONDS),
    "-i",
    input,
    "-an",
    "-sn",
    "-dn",
    // detail destroyed at w px (even height — H.264 needs it), blurred there; THEN enlarged smoothly and blurred again so
    // nothing blocky is stored, at a fluid frame rate
    "-vf",
    `scale=${w}:-2:flags=area,boxblur=1:1,scale=${big}:-2:flags=bicubic,gblur=sigma=${sigma},fps=${BLUR_CLIP_FPS},format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "baseline",
    "-level",
    "3.0",
    // 30 fps at 8× (recipe 3): a smooth gradient still compresses well — ~150–250 KB for 6 s, far under BLUR_CLIP_MAX_BYTES
    "-b:v",
    "240k",
    "-maxrate",
    "320k",
    "-bufsize",
    "640k",
    "-movflags",
    "+faststart",
    output,
  ];
}

/**
 * True when a locked video has no clip of the current recipe — none at all, only WebM ones (an iPhone may not play
 * them), or only older/browser-made ones without BLUR_CLIP_MARK (blocky, 12 fps) — the worker should make one.
 * An older clip keeps playing until the new one replaces it.
 */
export function lacksCurrentClip(clips: readonly (string | null | undefined)[]): boolean {
  return !clips.some((u) => typeof u === "string" && u.startsWith("https://") && !isWebmClip(u) && u.includes(BLUR_CLIP_MARK));
}

/**
 * The DATABASE side of lacksCurrentClip (code review, 2026-10-30): the rows the worker picks up, and the only rows its
 * save may overwrite. The feed asks for the worker whenever a stored clip fails lacksCurrentClip; the worker used to
 * select only `null` or a URL ENDING in .webm, so a clip that is not https, or a WebM one with a query
 * (…/clip.webm?v=2), was asked for every ten minutes and never made. Now the two are the same rule:
 *   none · not https:// (case-sensitive, like startsWith) · .webm at the end, or before a ? or # (like isWebmClip) ·
 *   no BLUR_CLIP_MARK (recipe 2 — case-sensitive, like includes).
 * PostgREST `or` syntax; the values are quoted because they carry `:`, `?` and `#`. blur-clip-plan.test.ts proves
 * this filter and lacksCurrentClip agree on every case.
 */
export const CLIP_NEEDS_WORK_FILTER = [
  "blur_video_url.is.null",
  'blur_video_url.not.like."https://*"',
  'blur_video_url.ilike."*.webm"',
  'blur_video_url.ilike."*.webm?*"',
  'blur_video_url.ilike."*.webm#*"',
  `blur_video_url.not.like."*${BLUR_CLIP_MARK}*"`,
].join(",");

/**
 * Does this locked post still need the worker? With per-item slides: any VIDEO slide without a current clip, or any
 * PHOTO slide without its blurred still (an album's later items count too). Without slides (a database before 0306): a
 * video post whose post-level clip is missing or of an older recipe.
 */
export function postNeedsBlurWork(slides: readonly { kind: string; blurUrl?: string; blurVideoUrl?: string }[] | undefined, hasVideo: boolean, postClip: string | null | undefined): boolean {
  if (slides?.length) return slides.some((x) => (x.kind === "video" ? lacksCurrentClip([x.blurVideoUrl]) : !x.blurUrl));
  return hasVideo && lacksCurrentClip([postClip]);
}

/** A stored clip an iPhone may not play (a browser that could only record WebM made it) — remade as MP4. */
export function isWebmClip(url: unknown): boolean {
  return typeof url === "string" && /\.webm(?:$|[?#])/i.test(url);
}
