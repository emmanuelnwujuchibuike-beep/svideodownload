/**
 * Where the download watermark sits — shared by the worker's ffmpeg filter
 * (server/services/watermark-service.ts) and the browser's photo stamp
 * (lib/media/watermark-image.ts), so both place it identically. Its own file
 * so the browser never imports the `next/og` renderer next to it.
 */

/** The mark's width as a share of the media's SHORTER side. */
export const MARK_SHARE = 0.46;
/** Inset from the left and bottom edges, as a share of the media's width/height. */
export const MARK_INSET = 0.035;
/** The mark PNG's canvas (lib/media/watermark-mark.tsx). Its aspect sizes the mark in ffmpeg. */
export const MARK_SIZE = { width: 1000, height: 220 };

/**
 * The watermark doesn't sit still (owner, 2026-10-14: "only at the bottom and
 * goes up, and switch every 3 seconds up and down, bottom right and left, top
 * right and left"). It starts bottom-left and steps through these corners,
 * one every WATERMARK_CORNER_SECONDS — bottom, top, bottom, top — on the
 * downloaded video (ffmpeg, lib/media/watermark-args.ts) and on a private
 * post's viewer badge (features/sub/sub-gallery.tsx). A photo can't move, so
 * it carries the first corner.
 *
 * 🔴 watermark-args.ts's ffmpeg expression assumes this exact order: index 0–1
 * on the left, 2–3 on the right; even indices at the bottom, odd at the top.
 */
export const WATERMARK_CORNERS = ["bottom-left", "top-left", "bottom-right", "top-right"] as const;
export type WatermarkCorner = (typeof WATERMARK_CORNERS)[number];
export const WATERMARK_CORNER_SECONDS = 3;
