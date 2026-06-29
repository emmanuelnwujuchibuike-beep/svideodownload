"use client";

import { useSyncExternalStore } from "react";

/** Tiny global store for the "upload / create" modal so the top bar, mobile
 *  plus button and the Stories row can all open the same composer. */
let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function openUpload() {
  open = true;
  emit();
}
export function closeUpload() {
  open = false;
  emit();
}
export function useUploadOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}
