"use client";

import { useSyncExternalStore } from "react";

/** Tiny global store for the "upload / create" composer so the top bar, mobile
 *  plus button and the Stories row can all open the same premium composer — each
 *  with its own default destination (a post, or a 24h story). */
export type UploadIntent = "post" | "story";

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
