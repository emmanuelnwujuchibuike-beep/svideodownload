"use client";

import { useSyncExternalStore } from "react";

/** Global open/close for the block-based Story Studio (mounted once app-wide). */
let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function openStudio() {
  open = true;
  emit();
}
export function closeStudio() {
  open = false;
  emit();
}
export function useStudioOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}
