"use client";

import { useEffect, useState } from "react";

/**
 * Who saw YOUR story — one read shared by the bottom bar of your own story (the
 * faces, "N viewers", "Ada, Chris and N others") and the "Seen by" sheet.
 * GET /api/stories/:id/views is the author's alone (403 for anyone else).
 *
 * Demand-driven only: it runs while the author is looking at their own story,
 * one request per story, kept for 30 s, concurrent callers sharing it. Nothing
 * polls, nothing runs while the viewer is closed.
 */

export interface StoryViewerRow {
  id: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  viewedAt: string;
  screenshotted: boolean;
  reacted?: boolean;
}

export interface StoryViewersData {
  screenshotAlerts: boolean;
  /** real counts; `null` = not countable yet (a migration not applied) — shown as a dash, never a guess */
  totals: { viewers: number; reactions: number | null; reshares: number | null };
  viewers: StoryViewerRow[];
}

export type StoryViewersState = { status: "loading" } | { status: "ready"; data: StoryViewersData } | { status: "error"; message: string };

const FRESH_MS = 30_000;
const kept = new Map<string, { at: number; data: StoryViewersData }>();
const inflight = new Map<string, Promise<StoryViewersData>>();

async function read(storyId: string): Promise<StoryViewersData> {
  const res = await fetch(`/api/stories/${encodeURIComponent(storyId)}/views`, { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as (Partial<StoryViewersData> & { error?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.error ?? "Couldn't load viewers.");
  const viewers = json.viewers ?? [];
  return {
    screenshotAlerts: json.screenshotAlerts !== false,
    totals: json.totals ?? { viewers: viewers.length, reactions: null, reshares: null },
    viewers,
  };
}

export function loadStoryViewers(storyId: string, maxAgeMs = FRESH_MS): Promise<StoryViewersData> {
  const k = kept.get(storyId);
  if (k && Date.now() - k.at < maxAgeMs) return Promise.resolve(k.data);
  const running = inflight.get(storyId);
  if (running) return running;
  const p = read(storyId)
    .then((data) => {
      kept.set(storyId, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(storyId));
  inflight.set(storyId, p);
  return p;
}

/** `storyId` null = not your story: nothing is read. */
export function useStoryViewers(storyId: string | null, maxAgeMs = FRESH_MS): StoryViewersState {
  const [state, setState] = useState<StoryViewersState>(() => {
    const k = storyId ? kept.get(storyId) : undefined;
    return k ? { status: "ready", data: k.data } : { status: "loading" };
  });
  useEffect(() => {
    if (!storyId) return;
    let alive = true;
    const k = kept.get(storyId);
    setState(k ? { status: "ready", data: k.data } : { status: "loading" });
    loadStoryViewers(storyId, maxAgeMs).then(
      (data) => alive && setState({ status: "ready", data }),
      (e: unknown) => alive && setState({ status: "error", message: e instanceof Error ? e.message : "Couldn't load viewers." }),
    );
    return () => {
      alive = false;
    };
  }, [storyId, maxAgeMs]);
  return state;
}

const FACE_GRADIENTS = [
  "linear-gradient(135deg, #7B3FE4, #3D1F8A)",
  "linear-gradient(160deg, #2F6B4F, #1E3D2E)",
  "linear-gradient(160deg, #D9A441, #8A5A1E)",
  "linear-gradient(135deg, #C23FD1, #7A1F8A)",
  "linear-gradient(135deg, #3D5AFE, #2A3BB0)",
  "linear-gradient(135deg, #4A4760, #1E1C2B)",
];

/** A face with no photo: the initial on one of the design's gradients, chosen by id so it never changes. */
export function faceGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FACE_GRADIENTS[h % FACE_GRADIENTS.length]!;
}

/** "Ada, Chris and 1,202 others" — from the real list and the real total. */
export function viewersLine(data: StoryViewersData): string {
  const names = data.viewers.slice(0, 2).map((v) => (v.displayName ?? v.handle ?? "Someone").split(" ")[0]!);
  const total = data.totals.viewers;
  if (total === 0 || names.length === 0) return "No viewers yet";
  const others = total - names.length;
  if (others <= 0) return names.join(" and ");
  return `${names.join(", ")} and ${others.toLocaleString()} ${others === 1 ? "other" : "others"}`;
}

/** Tests only. */
export function _resetStoryViewers() {
  kept.clear();
  inflight.clear();
}
