import { MAX_BATCH_ITEMS } from "@/lib/downloads/multi-link-config";
import type { MediaKind, PlatformId, VideoMetadata } from "@/types";

/**
 * Multi-Link batch state — a SOURCE-OWNED TREE, never a flat list (spec §8).
 *
 * ── Why the shape is the requirement ──────────────────────────────────────
 * "The user must always be able to determine exactly which source produced
 * each result." A flat `items[]` with a `sourceId` field satisfies that on
 * paper and loses it in practice: every render, every progress update and
 * every retry then has to re-group by that field, and the first place that
 * forgets to is a bug where Source 2's photos appear under Source 1. Here the
 * ownership is structural — an item cannot exist outside the source that
 * produced it, so there is no code path that can move one.
 *
 * ── Derived, not stored (§30) ─────────────────────────────────────────────
 * Totals, selected counts, completed/failed counts and per-source progress are
 * all functions at the bottom of this file. Storing them beside the tree would
 * be a second source of truth for the same fact, and the two drift the first
 * time an item changes status by a path that forgot to bump the counter.
 *
 * This module is deliberately PURE — no React, no fetch, no browser APIs — so
 * the source-separation guarantees are unit-testable without rendering
 * anything. `state.test.ts` is that test.
 */

export type SourceStatus = "idle" | "fetching" | "ready" | "error";
export type ItemStatus = "idle" | "queued" | "downloading" | "done" | "failed";

export interface BatchItem {
  /**
   * Source-scoped, NOT the bare formatId.
   *
   * Two different pins, posts or stories routinely expose the same format id
   * ("0", "720", "pin-img"). Keyed on formatId alone, ticking Source 1's photo
   * would tick Source 3's too — the precise cross-source leak §6 forbids.
   */
  id: string;
  sourceId: string;
  formatId: string;
  kind: MediaKind;
  label: string;
  title: string;
  thumbnail: string | null;
  filesize: number | null;
  /** Present for images — what the ZIP writer fetches. */
  directUrl: string | null;
  selected: boolean;
  status: ItemStatus;
  /** The download-manager task following this item, once queued. */
  taskId: string | null;
  error: string | null;
}

export interface BatchSource {
  id: string;
  /** Exactly what the member typed, shown back to them. */
  url: string;
  status: SourceStatus;
  error: string | null;
  /** Resolved from metadata once fetched — the compact domain indicator (§4). */
  platformName: string | null;
  /** Platform id, carried onto every download task so history and analytics
   *  attribute a batch item exactly as a single-link download would. */
  platform: PlatformId | null;
  /** The canonical URL the extractor resolved to (short links expand). */
  resolvedUrl: string | null;
  items: BatchItem[];
}

export type BatchPhase = "editing" | "authorizing" | "awaiting-reward" | "downloading" | "done";

export interface BatchState {
  sources: BatchSource[];
  /** Server-minted at `/authorize`. Never generated on the client — see that route. */
  batchId: string | null;
  phase: BatchPhase;
  /** A transient, human-readable message (duplicate source, cap hit, …). */
  notice: string | null;
}

export const initialBatchState: BatchState = {
  sources: [],
  batchId: null,
  phase: "editing",
  notice: null,
};

/**
 * URL normalization for duplicate detection (§22).
 *
 * Compares what two links POINT AT, not how they were typed. Case in the host,
 * a trailing slash, `www.`, and the share-tracking params every platform
 * appends (`?igshid=`, `?utm_source=`, `?fbclid=`) are all noise — the same
 * Instagram post copied from the app and from a browser differs in every one
 * of them, and telling someone those are two different sources would be wrong.
 *
 * The QUERY otherwise survives: on some platforms it carries the actual
 * identity (`?v=`, `?story_media_id=`), so stripping it wholesale would merge
 * genuinely different posts into one.
 */
const TRACKING_PARAMS = /^(utm_|fbclid$|igshid$|igsh$|si$|share_id$|_r$|_t$|ref$|ref_src$|feature$)/i;

export function normalizeSourceUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const u = new URL(trimmed);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    u.protocol = "https:";
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    const path = u.pathname.replace(/\/+$/, "");
    const query = u.searchParams.toString();
    return `${u.hostname}${path}${query ? `?${query}` : ""}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

export type BatchAction =
  | { type: "addSource"; url?: string }
  | { type: "editSource"; sourceId: string; url: string }
  | { type: "removeSource"; sourceId: string }
  | { type: "fetchStart"; sourceId: string }
  | { type: "fetchSuccess"; sourceId: string; metadata: VideoMetadata }
  | { type: "fetchError"; sourceId: string; message: string }
  | { type: "toggleItem"; sourceId: string; itemId: string }
  | { type: "setSourceSelection"; sourceId: string; selected: boolean }
  | { type: "setAllSelection"; selected: boolean }
  | { type: "itemQueued"; itemId: string; taskId: string }
  | { type: "itemStatus"; taskId: string; status: ItemStatus; error?: string | null }
  | { type: "retryFailed"; sourceId?: string }
  | { type: "setPhase"; phase: BatchPhase }
  | { type: "setBatchId"; batchId: string | null }
  | { type: "notice"; message: string | null }
  | { type: "reset" };

/** Replace one source, leaving every sibling's object identity untouched so
 *  React can skip re-rendering source cards that did not change. */
function mapSource(
  state: BatchState,
  sourceId: string,
  fn: (s: BatchSource) => BatchSource,
): BatchState {
  return {
    ...state,
    sources: state.sources.map((s) => (s.id === sourceId ? fn(s) : s)),
  };
}

/**
 * What an extractor result contributes to the batch.
 *
 * ── One source can be many posts (§5), and the split mirrors the single-link
 *    picker exactly ──────────────────────────────────────────────────────────
 * `isSeparateItem` formats are genuinely distinct media (a Snapchat story's
 * snaps, a slideshow's photos) — those become one item each. Everything else
 * is ALTERNATIVE QUALITIES of one post, so offering all of them as separate
 * "posts" would tell someone a single TikTok is 4 posts and download the same
 * video four times. In that case the batch takes exactly one: the best video,
 * or the image/audio if that is all there is.
 *
 * This is the same rule `preview-card.tsx` applies with `separateItems` — kept
 * consistent on purpose, because a link that shows 3 items in the single-link
 * flow and 1 here would read as a bug in whichever one the member saw second.
 */
function itemsFromMetadata(sourceId: string, meta: VideoMetadata): BatchItem[] {
  const separate = meta.formats.filter((f) => f.isSeparateItem);
  const chosen =
    separate.length > 1
      ? separate
      : (() => {
          const video = meta.formats.filter((f) => f.kind === "video");
          const image = meta.formats.filter((f) => f.kind === "image");
          const audio = meta.formats.filter((f) => f.kind === "audio");
          /*
            A multi-photo post is many items; a video post is one.

            Ordered video-first so a Pinterest video pin (which now carries its
            cover image as a real extra choice — see server/extractors/
            pinterest.ts) offers the VIDEO here, not the photo. Its image is
            still reachable through the single-link picker, where choosing
            between them is the whole point of the screen.
          */
          if (video.length > 0) return [video[0]!];
          if (image.length > 1) return image;
          if (image.length === 1) return [image[0]!];
          return audio.slice(0, 1);
        })();

  return chosen.map((f, i) => ({
    id: `${sourceId}:${f.formatId}:${i}`,
    sourceId,
    formatId: f.formatId,
    kind: f.kind,
    label: f.label,
    title: chosen.length > 1 ? `${meta.title || "Download"} · ${i + 1}` : meta.title || "Download",
    thumbnail: f.thumbnail ?? (f.kind === "image" ? f.directUrl : null) ?? meta.thumbnail,
    filesize: f.filesize ?? null,
    directUrl: f.kind === "image" ? (f.directUrl ?? null) : null,
    selected: true, // discovered posts arrive ticked; §7's Deselect All is one tap
    status: "idle" as const,
    taskId: null,
    error: null,
  }));
}

export function batchReducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case "addSource": {
      const id = `src-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      return {
        ...state,
        notice: null,
        sources: [
          ...state.sources,
          {
            id,
            url: action.url ?? "",
            status: "idle",
            error: null,
            platformName: null,
            platform: null,
            resolvedUrl: null,
            items: [],
          },
        ],
      };
    }

    case "editSource": {
      /*
        Editing a URL discards that source's results.

        They belong to the OLD link — keeping them would leave posts sitting
        under a URL that never produced them, which is the one thing §3
        forbids. Only this source is touched; siblings keep their results and
        their selections.
      */
      const dup = state.sources.find(
        (s) =>
          s.id !== action.sourceId &&
          s.url.trim() !== "" &&
          normalizeSourceUrl(s.url) === normalizeSourceUrl(action.url),
      );
      return mapSource(
        { ...state, notice: dup ? "This source has already been added." : null },
        action.sourceId,
        (s) => ({ ...s, url: action.url, status: "idle", error: null, items: [], resolvedUrl: null }),
      );
    }

    case "removeSource":
      return {
        ...state,
        notice: null,
        sources: state.sources.filter((s) => s.id !== action.sourceId),
      };

    case "fetchStart":
      return mapSource(state, action.sourceId, (s) => ({
        ...s,
        status: "fetching",
        error: null,
        items: [],
      }));

    case "fetchSuccess": {
      const items = itemsFromMetadata(action.sourceId, action.metadata);
      /*
        The item ceiling is enforced at the moment of DISCOVERY, not at
        download.

        `MAX_BATCH_ITEMS` is what the reward session will actually accept, so
        arriving with 80 ticked items and meeting a 400 on the Download tap is
        the worst possible moment to find out. Overflow is added UNTICKED
        rather than dropped — the posts genuinely exist and the member should
        see them; they just cannot all ride one batch.
      */
      const alreadySelected = countSelected(state);
      let room = Math.max(0, MAX_BATCH_ITEMS - alreadySelected);
      const capped = items.map((it) => {
        if (room > 0) {
          room -= 1;
          return it;
        }
        return { ...it, selected: false };
      });
      const overflowed = capped.some((it) => !it.selected);
      return mapSource(
        {
          ...state,
          notice: overflowed
            ? `A batch can carry up to ${MAX_BATCH_ITEMS} items — the extras are listed but not selected.`
            : state.notice,
        },
        action.sourceId,
        (s) => ({
          ...s,
          status: "ready",
          error: null,
          platformName: action.metadata.platformName ?? null,
          platform: action.metadata.platform ?? null,
          resolvedUrl: action.metadata.sourceUrl ?? null,
          items: capped,
        }),
      );
    }

    case "fetchError":
      return mapSource(state, action.sourceId, (s) => ({
        ...s,
        status: "error",
        error: action.message,
        items: [],
      }));

    case "toggleItem": {
      const source = state.sources.find((s) => s.id === action.sourceId);
      const item = source?.items.find((i) => i.id === action.itemId);
      // Only ADDING can cross the ceiling; untick is always free.
      if (item && !item.selected && countSelected(state) >= MAX_BATCH_ITEMS) {
        return { ...state, notice: `A batch can carry up to ${MAX_BATCH_ITEMS} items.` };
      }
      return mapSource({ ...state, notice: null }, action.sourceId, (s) => ({
        ...s,
        items: s.items.map((i) => (i.id === action.itemId ? { ...i, selected: !i.selected } : i)),
      }));
    }

    case "setSourceSelection": {
      /*
        §6: "Selecting/deselecting items in Source 1 must NOT modify selections
        in Source 2 or Source 3." `mapSource` is what guarantees it — every
        other source is returned by identity, so there is no path here that
        could touch one.
      */
      if (!action.selected) {
        return mapSource({ ...state, notice: null }, action.sourceId, (s) => ({
          ...s,
          items: s.items.map((i) => ({ ...i, selected: false })),
        }));
      }
      const source = state.sources.find((s) => s.id === action.sourceId);
      if (!source) return state;
      let room = MAX_BATCH_ITEMS - countSelected(state, source.id);
      const items = source.items.map((i) => {
        if (room > 0) {
          room -= 1;
          return { ...i, selected: true };
        }
        return { ...i, selected: false };
      });
      const clamped = items.some((i) => !i.selected);
      return mapSource(
        { ...state, notice: clamped ? `A batch can carry up to ${MAX_BATCH_ITEMS} items.` : null },
        action.sourceId,
        (s) => ({ ...s, items }),
      );
    }

    case "setAllSelection": {
      if (!action.selected) {
        return {
          ...state,
          notice: null,
          sources: state.sources.map((s) => ({
            ...s,
            items: s.items.map((i) => ({ ...i, selected: false })),
          })),
        };
      }
      // Fill in source order so the clamp is predictable — the first sources
      // the member added win, rather than whichever the iteration reached last.
      let room = MAX_BATCH_ITEMS;
      const sources = state.sources.map((s) => ({
        ...s,
        items: s.items.map((i) => {
          if (room > 0) {
            room -= 1;
            return { ...i, selected: true };
          }
          return { ...i, selected: false };
        }),
      }));
      const clamped = sources.some((s) => s.items.some((i) => !i.selected));
      return {
        ...state,
        sources,
        notice: clamped ? `A batch can carry up to ${MAX_BATCH_ITEMS} items.` : null,
      };
    }

    case "itemQueued":
      return {
        ...state,
        sources: state.sources.map((s) => ({
          ...s,
          items: s.items.map((i) =>
            i.id === action.itemId ? { ...i, taskId: action.taskId, status: "queued", error: null } : i,
          ),
        })),
      };

    case "itemStatus":
      /*
        Keyed by TASK id, because the download manager is what reports progress
        and it knows nothing about sources.

        One task can legitimately map to several items: the manager dedupes
        in-flight downloads by (url, formatId, kind), so the same photo added
        from two different source links shares a task. Updating every match —
        rather than the first — is what keeps both source cards honest.
      */
      return {
        ...state,
        sources: state.sources.map((s) => ({
          ...s,
          items: s.items.map((i) =>
            i.taskId === action.taskId
              ? { ...i, status: action.status, error: action.error ?? null }
              : i,
          ),
        })),
      };

    case "retryFailed":
      // Clears the failure so the runner picks these up again. Scoped to one
      // source when given (§12's "Retry Source"), otherwise every failure.
      return {
        ...state,
        notice: null,
        sources: state.sources.map((s) =>
          action.sourceId && s.id !== action.sourceId
            ? s
            : {
                ...s,
                items: s.items.map((i) =>
                  i.status === "failed"
                    ? { ...i, status: "idle", error: null, taskId: null, selected: true }
                    : i,
                ),
              },
        ),
      };

    case "setPhase":
      return { ...state, phase: action.phase };

    case "setBatchId":
      return { ...state, batchId: action.batchId };

    case "notice":
      return { ...state, notice: action.message };

    case "reset":
      return initialBatchState;

    default:
      return state;
  }
}

// ── Derived values (§30: computed, never stored) ─────────────────────────────

export function allItems(state: BatchState): BatchItem[] {
  return state.sources.flatMap((s) => s.items);
}

/** Selected items, optionally ignoring one source (used when recomputing that
 *  source's own "select all" room). */
export function countSelected(state: BatchState, excludeSourceId?: string): number {
  return state.sources.reduce(
    (n, s) =>
      s.id === excludeSourceId ? n : n + s.items.reduce((m, i) => m + (i.selected ? 1 : 0), 0),
    0,
  );
}

export function selectedItems(state: BatchState): BatchItem[] {
  return allItems(state).filter((i) => i.selected);
}

export function countItems(state: BatchState): number {
  return state.sources.reduce((n, s) => n + s.items.length, 0);
}

export function countFetchedSources(state: BatchState): number {
  return state.sources.filter((s) => s.status === "ready").length;
}

export interface SourceProgress {
  total: number;
  done: number;
  failed: number;
  active: number;
}

export function sourceProgress(source: BatchSource): SourceProgress {
  const engaged = source.items.filter((i) => i.status !== "idle");
  return {
    total: engaged.length,
    done: engaged.filter((i) => i.status === "done").length,
    failed: engaged.filter((i) => i.status === "failed").length,
    active: engaged.filter((i) => i.status === "queued" || i.status === "downloading").length,
  };
}

export function batchProgress(state: BatchState): SourceProgress {
  return state.sources.reduce<SourceProgress>(
    (acc, s) => {
      const p = sourceProgress(s);
      return {
        total: acc.total + p.total,
        done: acc.done + p.done,
        failed: acc.failed + p.failed,
        active: acc.active + p.active,
      };
    },
    { total: 0, done: 0, failed: 0, active: 0 },
  );
}

export function hasFailures(state: BatchState): boolean {
  return state.sources.some((s) => s.items.some((i) => i.status === "failed"));
}

/** Sources that carry a real, fetchable URL — what "Fetch all" and the
 *  authorize call count. Blank slots are UI, not sources. */
export function filledSources(state: BatchState): BatchSource[] {
  return state.sources.filter((s) => s.url.trim() !== "");
}

/** True when every selected item is an image — the only case a ZIP is worth
 *  offering (§15: never force it where it is inefficient). See `zip.ts`. */
export function zipEligible(state: BatchState): boolean {
  const sel = selectedItems(state);
  return sel.length > 1 && sel.every((i) => i.kind === "image" && !!i.directUrl);
}
