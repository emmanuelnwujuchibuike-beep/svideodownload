"use client";

import { useSyncExternalStore } from "react";

import {
  cancelDownload,
  clearFinished,
  getServerSnapshot,
  getSnapshot,
  pauseAll,
  pauseDownload,
  resumeDownload,
  retryDownload,
  startDownload,
  subscribe,
} from "./manager";

/** React binding for the in-app download manager. */
export function useDownloadManager() {
  const tasks = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    tasks,
    startDownload,
    pauseDownload,
    resumeDownload,
    retryDownload,
    cancelDownload,
    pauseAll,
    clearFinished,
  };
}
