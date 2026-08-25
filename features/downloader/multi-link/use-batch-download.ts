"use client";

import { useEffect, useRef } from "react";

import {
  getSnapshot as getDownloads,
  subscribe as subscribeDownloads,
  type TaskStatus,
} from "@/features/downloads/manager";

import type { BatchAction, ItemStatus } from "./state";

/**
 * Mirrors the download manager's task states back onto the batch tree, so
 * every source card shows its OWN progress (§13/§14).
 *
 * ── Why nothing here runs a download queue ────────────────────────────────
 * `features/downloads/manager.ts` already is one: it caps concurrent transfers
 * (MAX_CONCURRENT), auto-retries failures, streams with real progress, saves
 * to the device and writes history. §11's requirements are its existing
 * behaviour, not something to reimplement — a second queue in front of it
 * would fight it for slots and produce exactly the "batch always shows failed"
 * flood the manager's own gate was added to fix.
 *
 * So the batch panel ENQUEUES into the manager and watches. This hook is only
 * the watching half: manager task id → batch item status.
 *
 * ── Subscribed, not polled ────────────────────────────────────────────────
 * `subscribe` is the manager's own change beat. A `setInterval` would either
 * lag behind real progress or burn CPU on a phone for the entire length of a
 * batch — the thing §23/§48 explicitly forbid.
 */

function toItemStatus(s: TaskStatus): ItemStatus | null {
  switch (s) {
    case "queued":
    case "preparing":
      return "queued";
    case "downloading":
    case "paused":
      return "downloading";
    case "completed":
      return "done";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return null;
  }
}

export function useBatchDownloadWatcher(
  dispatch: (a: BatchAction) => void,
  /** Task ids this batch owns. Anything else in the manager (a single-link
   *  download running alongside) must not touch the batch's state. */
  ownedTaskIds: ReadonlySet<string>,
  enabled: boolean,
) {
  /** Last status dispatched per task — dispatching an unchanged status on every
   *  manager beat would re-render every source card several times a second for
   *  the whole batch. */
  const lastSeen = useRef(new Map<string, ItemStatus>());

  useEffect(() => {
    if (!enabled) return;

    const sync = () => {
      for (const task of getDownloads()) {
        if (!ownedTaskIds.has(task.id)) continue;
        const next = toItemStatus(task.status);
        if (!next) continue;
        if (lastSeen.current.get(task.id) === next) continue;
        lastSeen.current.set(task.id, next);
        dispatch({
          type: "itemStatus",
          taskId: task.id,
          status: next,
          error: next === "failed" ? (task.error ?? "This item couldn't be downloaded.") : null,
        });
      }
    };

    sync(); // catch anything that already finished before this subscribed
    return subscribeDownloads(sync);
  }, [dispatch, ownedTaskIds, enabled]);
}
