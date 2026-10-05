"use client";

import { useEffect } from "react";
import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";

const KEY = "frenz:device-checked";

/**
 * Invisible, mount-once bootstrap (same pattern as `PresenceTracker` /
 * `OfflineQueueSync`) — fires the new-device security check exactly once per
 * browser session (sessionStorage-gated, so navigating between pages never
 * re-fires it). Fully fire-and-forget: a failure here must never surface to
 * the user or affect anything else in the app.
 */
export function DeviceCheck() {
  useEffect(() => {
    // A guest has no device session to check (2026-10-05: this POSTed on every
    // guest visit to a public app page). Gated BEFORE the session marker, so a
    // guest who signs in later in this tab is still checked.
    if (!hasAuthCookie()) return;
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* storage blocked — just skip this session rather than re-fire on every nav */
      return;
    }
    fetch("/api/auth/device-check", { method: "POST" }).catch(() => {});
  }, []);
  return null;
}
