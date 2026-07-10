"use client";

import { useEffect } from "react";

import { replayOfflineActions } from "@/lib/offline/action-queue";

/**
 * Invisible, mount-once bootstrap (same pattern as `PresenceTracker`) that
 * replays any offline-queued Like/Save writes: once on load (covers "queued
 * offline, closed the tab, reopened later already online") and again on every
 * `online` event (covers "went offline mid-session, came back").
 */
export function OfflineQueueSync() {
  useEffect(() => {
    void replayOfflineActions();
    window.addEventListener("online", replayOfflineActions);
    return () => window.removeEventListener("online", replayOfflineActions);
  }, []);
  return null;
}
