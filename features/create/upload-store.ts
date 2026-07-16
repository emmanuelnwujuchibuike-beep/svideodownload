"use client";

import { useSyncExternalStore } from "react";

/** Tiny global store for the "upload / create" composer so the top bar, mobile
 *  plus button and the Stories row can all open the same premium composer — each
 *  with its own default destination (a post, a reel, or a 24h story).
 *
 *  "reel" added 2026-07-16 for the mockup's "+" action sheet (Create Reel).
 *  Reels are not a new destination so much as a post whose `format` is `reel`
 *  (see the posts.format column / feed-reels-split) — this intent just lets the
 *  composer OPEN already pointed at that format, the same way "story" does,
 *  instead of the user picking it afterwards. */
export type UploadIntent = "post" | "reel" | "story";

let open = false;
let intent: UploadIntent = "post";
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Open the composer. Pass "story" to default to the 24h Story destination. */
export function openUpload(mode: UploadIntent = "post") {
  open = true;
  intent = mode;
  emit();
}
export function closeUpload() {
  open = false;
  emit();
}
export function useUploadOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}
export function useUploadIntent(): UploadIntent {
  return useSyncExternalStore(subscribe, () => intent, () => "post");
}
