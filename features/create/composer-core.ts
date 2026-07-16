"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { NEUTRAL_EDIT, type PhotoEdit } from "@/features/create/photo-editor";
import { captureVideoPoster } from "@/lib/media/video-poster";
import { uploadPostMedia } from "@/lib/storage/client-upload";
import { createClient } from "@/lib/supabase/client";

/**
 * Shared MECHANICS for the three create surfaces (/create/post, /create/reel,
 * /create/story) — file validation, object-URL lifecycle, poster capture,
 * upload and publish.
 *
 * Deliberately contains ZERO presentation. The owner's split
 * ("all shouldnt use one global editor style sheet") is about the SURFACE:
 * Post, Reel and Story each own their own layout, chrome and styling. What they
 * legitimately share is the upload pipeline — that's one network contract
 * (`POST /api/stories`), and forking it three ways would just mean three places
 * to fix the next upload bug. Nothing in this file renders anything.
 */

export const MAX_BYTES = 100 * 1024 * 1024;
export const MAX_ITEMS = 20;

/** One item of a (possibly multi-media) composition. Edits are non-destructive:
 *  the original file + parameter object are kept; `file`/`display` hold the
 *  baked result after Apply. */
export interface AlbumItem {
  id: string;
  file: File;
  original: File;
  kind: "image" | "video";
  /** Object URL of the ORIGINAL (the photo editor always derives from this). */
  preview: string;
  /** Object URL currently shown (edited output, or the original). */
  display: string;
  edit: PhotoEdit;
}

export type Destination = "post" | "reel" | "story" | "both";

/** What a surface will accept from the file picker. */
export type MediaFilter = "any" | "video" | "image";

export interface MediaRules {
  filter: MediaFilter;
  /** Hard cap on items. Reels and Stories are single-media by product rule. */
  maxItems: number;
  /** Message shown when a file is rejected by `filter`. */
  rejectMessage: string;
}

export const POST_RULES: MediaRules = {
  filter: "any",
  maxItems: MAX_ITEMS,
  rejectMessage: "Please choose photos or videos.",
};

// Reels are single-video by product rule — the feed/reels split (posts.format)
// and /api/stories both enforce "any album publishes to the feed, never Reels".
// The surface refuses the file up front rather than silently redirecting the
// user's Reel to the feed at publish time.
export const REEL_RULES: MediaRules = {
  filter: "video",
  maxItems: 1,
  rejectMessage: "Reels are videos — pick a video to continue.",
};

export const STORY_RULES: MediaRules = {
  filter: "any",
  maxItems: 1,
  rejectMessage: "Please choose a photo or video.",
};

function revoke(it: AlbumItem) {
  URL.revokeObjectURL(it.preview);
  if (it.display !== it.preview) URL.revokeObjectURL(it.display);
}

/**
 * Media selection state + object-URL lifecycle for one composer surface.
 * `rules` decides what's accepted and how many.
 */
export function useComposerMedia(rules: MediaRules) {
  const [items, setItems] = useState<AlbumItem[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  // Revoke every outstanding object URL when the surface unmounts. A create
  // route is a real page now, so leaving it (back gesture, nav) unmounts us —
  // without this each visit would leak every preview it ever created.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => () => itemsRef.current.forEach(revoke), []);

  const accept = useCallback(
    (files: FileList | File[] | null | undefined) => {
      if (!files || files.length === 0) return;
      const list = Array.from(files);
      const fresh: AlbumItem[] = [];
      let localErr: string | null = null;

      for (const f of list) {
        const isVideo = f.type.startsWith("video/");
        const isImage = f.type.startsWith("image/");
        const kindOk =
          rules.filter === "any" ? isVideo || isImage : rules.filter === "video" ? isVideo : isImage;
        if (!kindOk) {
          localErr = rules.rejectMessage;
          continue;
        }
        if (f.size > MAX_BYTES) {
          localErr = `"${f.name}" is over 100 MB — skipped.`;
          continue;
        }
        if (itemsRef.current.length + fresh.length >= rules.maxItems) {
          localErr =
            rules.maxItems === 1
              ? "One at a time here — pick a single file."
              : `Up to ${rules.maxItems} items per post.`;
          break;
        }
        const url = URL.createObjectURL(f);
        fresh.push({
          id: crypto.randomUUID(),
          file: f,
          original: f,
          kind: isVideo ? "video" : "image",
          preview: url,
          display: url,
          edit: NEUTRAL_EDIT,
        });
      }

      setErr(localErr);
      if (fresh.length === 0) return;
      setItems((prev) => {
        setActiveIdx(prev.length); // jump to the first newly added item
        return [...prev, ...fresh];
      });
    },
    [rules],
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx === -1) return prev;
      revoke(prev[idx]!);
      const next = prev.filter((i) => i.id !== id);
      setActiveIdx((a) => Math.max(0, Math.min(a > idx ? a - 1 : a, next.length - 1)));
      return next;
    });
  }, []);

  /** Replace one item's baked output after a photo edit (non-destructive). */
  const applyEdit = useCallback((id: string, blob: Blob, edit: PhotoEdit) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        if (it.display !== it.preview) URL.revokeObjectURL(it.display);
        const edited = new File([blob], it.original.name.replace(/\.\w+$/, "") + "-edited.jpg", {
          type: "image/jpeg",
        });
        return { ...it, file: edited, display: URL.createObjectURL(edited), edit };
      }),
    );
  }, []);

  /** Move the active item one step (item 0 is the cover). */
  const move = useCallback(
    (dir: -1 | 1) => {
      const from = activeIdx;
      const to = from + dir;
      setItems((prev) => {
        if (to < 0 || to >= prev.length) return prev;
        const next = [...prev];
        const [it] = next.splice(from, 1);
        next.splice(to, 0, it!);
        return next;
      });
      setActiveIdx((a) => (to < 0 || to >= itemsRef.current.length ? a : to));
    },
    [activeIdx],
  );

  const reset = useCallback(() => {
    itemsRef.current.forEach(revoke);
    setItems([]);
    setActiveIdx(0);
    setErr(null);
  }, []);

  const active = items[Math.min(activeIdx, Math.max(0, items.length - 1))];

  return { items, active, activeIdx, setActiveIdx, err, setErr, accept, remove, applyEdit, move, reset };
}

export interface PublishResult {
  postId: string | null;
  storyId: string | null;
  link: string;
}

/**
 * Upload every item (cover first) and publish. Video items also get a
 * first-frame poster so the feed/reels always have a cover.
 *
 * Throws `Error` with a user-safe message on any failure — callers surface it
 * directly.
 */
export async function publishComposition({
  items,
  caption,
  destination,
  onProgress,
}: {
  items: AlbumItem[];
  caption: string;
  destination: Destination;
  onProgress?: (text: string) => void;
}): Promise<PublishResult> {
  if (items.length === 0) throw new Error("Pick something to share first.");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in.");

  const uploaded: { url: string; kind: "image" | "video"; thumbnailUrl: string | null }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    onProgress?.(items.length > 1 ? `Uploading ${i + 1} of ${items.length}…` : "Uploading…");
    const ext = (it.file.name.split(".").pop() || (it.kind === "video" ? "mp4" : "jpg"))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    let posterBlob: Blob | null = null;
    if (it.kind === "video") posterBlob = await captureVideoPoster(it.file).catch(() => null);

    let mediaUrl: string;
    try {
      mediaUrl = await uploadPostMedia({
        data: it.file,
        kind: it.kind,
        ext,
        contentType: it.file.type || (it.kind === "video" ? "video/mp4" : "image/jpeg"),
      });
    } catch (e) {
      throw new Error(
        e instanceof Error ? e.message : `Upload failed on item ${i + 1}. Try a smaller file.`,
      );
    }

    let thumbnailUrl: string | null = null;
    if (posterBlob) {
      thumbnailUrl = await uploadPostMedia({
        data: posterBlob,
        kind: "image",
        ext: "jpg",
        contentType: "image/jpeg",
      }).catch(() => null);
    }
    uploaded.push({ url: mediaUrl, kind: it.kind, thumbnailUrl });
  }

  onProgress?.("Publishing…");
  const cover = uploaded[0]!;
  const res = await fetch("/api/stories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mediaUrl: cover.url,
      mediaKind: cover.kind,
      caption: caption.trim() || undefined,
      thumbnailUrl: cover.kind === "image" ? cover.url : (cover.thumbnailUrl ?? undefined),
      destination,
      ...(uploaded.length > 1
        ? { media: uploaded.map((u) => ({ url: u.url, kind: u.kind, thumbnailUrl: u.thumbnailUrl })) }
        : {}),
    }),
  });

  let json: { error?: string; postId?: string | null; storyId?: string | null };
  try {
    json = await res.json();
  } catch {
    throw new Error("Couldn't publish.");
  }
  if (!res.ok) throw new Error(json.error ?? "Couldn't publish.");

  const postId = json.postId ?? null;
  return {
    postId,
    storyId: json.storyId ?? null,
    link: postId ? `${window.location.origin}/p/${postId}` : `${window.location.origin}/home`,
  };
}

/**
 * Body-scroll lock for a create surface. Each create route is a real page, but
 * it paints as a full-screen `fixed` layer over the still-scrollable (app)
 * shell behind it — without this, flicking the composer's edges scrolls the
 * feed underneath.
 *
 * Follows the app-wide convention exactly: `overflowY` only, never the
 * `overflow` shorthand (which would also reset the `overflow-x: clip` that
 * keeps the sticky sidebar working). See lib/dom/scroll-lock.ts.
 */
export function useComposerScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.body.style.overflowY = prev;
    };
  }, []);
}

/** Caption draft persistence, scoped per surface so a Reel caption never
 *  bleeds into a Post. (The selected File objects themselves can't survive a
 *  remount via localStorage — losing typed text is the recoverable half.) */
export function useCaptionDraft(key: string) {
  const storageKey = `frenz:create-draft:${key}`;
  const [caption, setCaption] = useState("");

  // Read after mount, never during render — these surfaces are server-rendered
  // routes now, so touching localStorage in a useState initializer would be a
  // hydration mismatch (server has no storage).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setCaption(saved);
    } catch {
      /* storage unavailable — draft just won't restore */
    }
  }, [storageKey]);

  useEffect(() => {
    try {
      if (caption.trim()) localStorage.setItem(storageKey, caption);
      else localStorage.removeItem(storageKey);
    } catch {
      /* storage unavailable/full — draft just won't persist */
    }
  }, [caption, storageKey]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return { caption, setCaption, clearDraft };
}
