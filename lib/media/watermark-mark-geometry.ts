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
