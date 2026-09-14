"use client";

import { useSyncExternalStore } from "react";

import {
  addDownload,
  clearHistory,
  getServerSnapshot,
  getSnapshot,
  removeDownload,
  subscribe,
  toggleFavorite,
} from "./store";

/** React binding for the download-history store. */
/*
  `ready` is false for the server render and the hydration pass — the one
  frame where the store has not read localStorage yet — and true from the
  first client snapshot on. Without it an empty server snapshot painted the
  "No downloads yet" state (fading in from opacity 0) for the length of that
  frame on every cold entry: "a white blank screen half of the page" (owner,
  2026-09-14). The panel draws a skeleton grid instead until this is true.
*/
const readyNow = () => true;
const readyOnServer = () => false;

export function useHistory() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = useSyncExternalStore(subscribe, readyNow, readyOnServer);
  return {
    items,
    ready,
    addDownload,
    toggleFavorite,
    removeDownload,
    clearHistory,
  };
}
