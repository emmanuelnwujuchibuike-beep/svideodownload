"use client";

import { useCallback, useState } from "react";

import { GHOST_SIGNALS, writesFor, type GhostState } from "@/lib/privacy/ghost";
import { setMyBroadcastLocal, setMyPresenceStatusLocal } from "@/lib/social/presence-status-client";

/*
  Its own small module (2026-10-19): Settings' quick tile needs only this hook, not the whole Ghost
  Mode screen — so the screen's UI stays out of Settings' first load.
*/
/**
 * The Ghost Mode state and its ONE write path, shared by this panel and the Settings quick tile
 * (design/Settings.dc.html, 2026-10-18) so a switch on either screen saves exactly the same way.
 */
export function useGhostMode(initial: GhostState) {
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    async (target: Partial<GhostState>, key: string) => {
      const previous = state;
      const next = { ...state, ...target };
      const writes = writesFor(target, state);

      setState(next);
      setBusy(key);
      setError(null);

      const failures: string[] = [];
      // Sequential, not parallel: two privacy writes racing on the same row is
      // a last-write-wins bug waiting to happen, and there are at most two.
      if (Object.keys(writes.privacy).length > 0) {
        try {
          const res = await fetch("/api/privacy", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(writes.privacy),
          });
          if (!res.ok) failures.push("privacy");
          // Feature 19 Part 9: leave or rejoin the public online channel now, not on the next reload
          else if (typeof writes.privacy.last_seen_visibility === "string") setMyBroadcastLocal(writes.privacy.last_seen_visibility === "everyone");
        } catch {
          failures.push("privacy");
        }
      }
      if (writes.presence) {
        try {
          // PATCH, not POST. The route exports PATCH only, so a POST was a
          // 405 that this code dutifully reported as a failure and reverted —
          // which is why the online-status switch would not stay on.
          const res = await fetch("/api/presence-status", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: writes.presence }),
          });
          if (!res.ok) failures.push("presence");
          // the live cache use-presence.ts reads: Invisible untracks at once
          else setMyPresenceStatusLocal(writes.presence);
        } catch {
          failures.push("presence");
        }
      }

      if (failures.length > 0) {
        // Revert only what failed, so a partial success is reported honestly
        // rather than rolled back wholesale.
        setState((current) => {
          const fixed = { ...current };
          for (const s of GHOST_SIGNALS) {
            const store = s.source === "user_presence_status" ? "presence" : "privacy";
            if (failures.includes(store)) fixed[s.key] = previous[s.key];
          }
          return fixed;
        });
        setError(
          failures.includes("privacy") && failures.includes("presence")
            ? "Couldn't save. Check your connection and try again."
            : `Saved, except your ${failures[0] === "presence" ? "online status" : "privacy settings"}. Try again.`,
        );
      }
      setBusy(null);
    },
    [state],
  );
  return { state, busy, error, apply };
}

