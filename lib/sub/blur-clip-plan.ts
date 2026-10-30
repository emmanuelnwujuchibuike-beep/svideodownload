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
 * Pure: arguments only, so a test can read the exact command.
 */
export const BLUR_CLIP_WIDTH = 24;
export const BLUR_CLIP_SECONDS = 4;
export const BLUR_CLIP_FPS = 12;
/** A real 24 px, 4 s clip is a few KB; anything near this is not one. */
export const BLUR_CLIP_MAX_BYTES = 512 * 1024;

export function buildBlurClipArgs(input: string, output: string): string[] {
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
    // 24 px wide, even height (H.264 needs it), blurred at that size, the browser clip's frame rate
    "-vf",
    `scale=${BLUR_CLIP_WIDTH}:-2:flags=area,boxblur=1:1,fps=${BLUR_CLIP_FPS},format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-profile:v",
    "baseline",
    "-level",
    "3.0",
    "-b:v",
    "40k",
    "-maxrate",
    "60k",
    "-bufsize",
    "120k",
    "-movflags",
    "+faststart",
    output,
  ];
}

/** True when a locked video has no clip an iPhone can play: none at all, or only WebM ones — the worker should make one. */
export function lacksPlayableClip(clips: readonly (string | null | undefined)[]): boolean {
  return !clips.some((u) => typeof u === "string" && u.startsWith("https://") && !isWebmClip(u));
}

/**
 * The DATABASE side of lacksPlayableClip (code review, 2026-10-30): the rows the worker picks up, and the only rows its
 * save may overwrite. The feed asks for the worker whenever a stored clip fails lacksPlayableClip; the worker used to
 * select only `null` or a URL ENDING in .webm, so a clip that is not https, or a WebM one with a query
 * (…/clip.webm?v=2), was asked for every ten minutes and never made. Now the two are the same rule:
 *   none · not https:// (case-sensitive, like startsWith) · .webm at the end, or before a ? or # (like isWebmClip).
 * PostgREST `or` syntax; the values are quoted because they carry `:`, `?` and `#`. blur-clip-plan.test.ts proves
 * this filter and lacksPlayableClip agree on every case.
 */
export const CLIP_NEEDS_WORK_FILTER = [
  "blur_video_url.is.null",
  'blur_video_url.not.like."https://*"',
  'blur_video_url.ilike."*.webm"',
  'blur_video_url.ilike."*.webm?*"',
  'blur_video_url.ilike."*.webm#*"',
].join(",");

/**
 * Does this locked post still need the worker? With per-item slides: any VIDEO slide without a playable clip, or any
 * PHOTO slide without its blurred still (an album's later items count too). Without slides (a database before 0306): a
 * video post whose post-level clip is missing.
 */
export function postNeedsBlurWork(slides: readonly { kind: string; blurUrl?: string; blurVideoUrl?: string }[] | undefined, hasVideo: boolean, postClip: string | null | undefined): boolean {
  if (slides?.length) return slides.some((x) => (x.kind === "video" ? lacksPlayableClip([x.blurVideoUrl]) : !x.blurUrl));
  return hasVideo && lacksPlayableClip([postClip]);
}

/** A stored clip an iPhone may not play (a browser that could only record WebM made it) — remade as MP4. */
export function isWebmClip(url: unknown): boolean {
  return typeof url === "string" && /\.webm(?:$|[?#])/i.test(url);
}
