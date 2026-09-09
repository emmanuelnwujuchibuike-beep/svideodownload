/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PROPAINTER'S MEMORY BUDGET — pure, so it can be tested without a GPU
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 🔴 Its own module because lib/ai/propainter.ts imports `server-only`, and a
 * vitest file that imports that module dies before it runs a single
 * assertion. The arithmetic below is the whole reason three jobs failed, so it
 * is exactly the part that must be under test — putting it behind a guard
 * that makes it untestable is how it would go wrong again unnoticed.
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THE SECOND CUDA OOM, AND WHY THE FIRST FIX DID NOT PREVENT IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three consecutive jobs failed on 2026-09-09 with:
 *
 *     CUDA out of memory. Tried to allocate 15.64 GiB (44.39 GiB capacity;
 *     359.31 MiB free; 43.53 GiB reserved in total by PyTorch)
 *
 * …with `subvideo_length: 40`, `neighbor_length: 6`, `ref_stride: 12` already
 * applied. Those are the values that fixed the FIRST OOM, and the note beside
 * them in config.ts said they "reduce MEMORY, not resolution". That was true,
 * and it was not enough, because this is a different allocation:
 *
 *     model/modules/flow_comp_raft.py:49   fix_raft(...)
 *     RAFT/raft.py:109                     CorrBlock(fmap1, fmap2, ...)
 *     RAFT/corr.py:60                      corr / sqrt(dim)
 *
 * ── The optical flow is computed OUTSIDE the sub-video loop ─────────────────
 *
 * ProPainter estimates flow across the clip before it inpaints anything, so
 * `subvideo_length` — which bounds the INPAINTING chunk — does not bound this
 * at all. And RAFT's correlation volume is all-pairs over the 1/8-scale feature
 * map, so it costs
 *
 *     (W/8 x H/8)^2 x 4 bytes  per frame pair
 *
 * which is quadratic in AREA. The arithmetic matches the failure exactly:
 * 720x1280 gives 90x160 = 14,400 positions, 14,400^2 x 4 = 829 MB per pair,
 * and a batch of ~19 pairs is the 15.64 GiB it asked for.
 *
 * Quadratic in area means resolution is the ONLY lever that moves it, and it
 * moves it hard: two thirds of the width and height is a fifth of the memory.
 *
 * ── Why this is not a quality regression worth refusing ─────────────────────
 *
 * The reconstruction happens at the reduced size and `buildResizeToSourceArgs`
 * puts the frame back to the source's exact dimensions afterwards, so the
 * member's video keeps its resolution — what is reduced is the resolution the
 * INPAINTED PATCH was invented at. For a caption-sized region that is a soft
 * edge; the alternative measured on these three jobs is no video at all.
 *
 * 🔴 The budget is the area of a run that is KNOWN to have succeeded
 * (480x854 = 409,920 px, the owner's Snapchat clip), not a number chosen for
 * how it reads. A 720x1280 job lands at ratio 0.66.
 */
export function propainterResizeRatio(
  width: number | null | undefined,
  height: number | null | undefined,
  maxPixels: number,
): number {
  /*
    🔴 An unknown size gets the FULL ratio, not a guessed reduction. A probe
    that failed to read dimensions is not evidence the video is large, and
    silently shrinking every video whose header we could not parse would
    degrade the ones that never needed it. The job still has the fallback path
    if it OOMs; a needless downscale has no path back.
  */
  if (!width || !height || width <= 0 || height <= 0) return 1;
  const pixels = width * height;
  if (pixels <= maxPixels) return 1;
  /*
    Rounded DOWN to two decimals so the result is always at or under budget —
    rounding to nearest could land a borderline clip back over the line, which
    is the one direction that costs a whole failed GPU run.
  */
  const ratio = Math.sqrt(maxPixels / pixels);
  return Math.max(0.1, Math.floor(ratio * 100) / 100);
}
