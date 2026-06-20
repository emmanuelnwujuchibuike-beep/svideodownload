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
export function useHistory() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    items,
    addDownload,
    toggleFavorite,
    removeDownload,
    clearHistory,
  };
}
