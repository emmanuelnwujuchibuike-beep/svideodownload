"use client";

import { dismissToast, toast } from "@/features/ui/toast";
import { saveMediaToDevice } from "@/lib/media/save-to-device";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SAVING A POST — the social route, on the page you are already on
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-31: "Downloading multi post in feed just dispears and show in
 * the Download page Successful but when I try to review it shows blank ... it
 * should download through it social Download route like Twitter not going
 * through the link download route in the landing page ... it should download
 * directly on same page on a separate social media route, and it should show
 * clear and high quality ... should save in same page like Twitter and save to
 * device."
 *
 * ── 🔴 Three bugs, one cause: this used the DOWNLOADER's queue ───────────────
 *
 * It authorized correctly through the post's own route and then handed the job
 * to `startDownload()` — the pipeline built for pasted third-party links. That
 * produced every symptom in the report at once:
 *
 *  1. "just dispears" — `startDownload` enqueues into the download MANAGER, so
 *     the item left the feed and reappeared on /downloads. Nothing was ever
 *     saved on the page the person was looking at.
 *  2. "shows blank" — the call hard-coded `kind: "video"`. Every IMAGE post in
 *     the feed was therefore queued, named and written as a video, which is a
 *     file that opens to nothing. The queue had no reason to think it failed,
 *     so it reported Successful over it.
 *  3. albums lost everything but the cover — it only ever passed one url, and
 *     the route only ever returned one (both fixed; the route now returns every
 *     item from `post_media`).
 *
 * ── What it does now ────────────────────────────────────────────────────────
 *
 * Authorize, then hand each file to `saveMediaToDevice`. That fetches the
 * ORIGINAL stored object through our own origin and gives it to the OS — the
 * share sheet on iOS (the only path to the Photos library) and a blob download
 * elsewhere. No queue, no navigation, no re-extraction, no re-encode: the bytes
 * that land on the device are the bytes we stored, which is where "clear and
 * high quality" comes from.
 *
 * The `kind` now comes from the SERVER, per item, so an album of mixed photos
 * and videos saves each one correctly instead of calling all of them video.
 */

export interface SavePostResult {
  saved: number;
  cancelled: number;
  total: number;
  /** Set when nothing could be attempted at all (auth, quota, network). */
  error?: string;
}

interface DownloadItem {
  url: string;
  kind: string;
  filename: string;
}

/**
 * The shared core: authorize the post, save every file it is made of.
 *
 * Returns rather than toasts, so the React hook can drive a per-item progress
 * label off the same code the plain-function wrapper below uses. Two copies of
 * this logic is how the feed and the post page drift apart.
 */
export async function savePostMedia(
  postId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<SavePostResult> {
  let body: { url?: string; filename?: string; items?: DownloadItem[]; error?: string } = {};
  let res: Response;
  try {
    res = await fetch(`/api/posts/${postId}/download`, { method: "POST", credentials: "same-origin" });
    body = (await res.json().catch(() => ({}))) as typeof body;
  } catch {
    return { saved: 0, cancelled: 0, total: 0, error: "Couldn't download." };
  }

  if (!res.ok) {
    // 401 signed out, 402 daily cap (its message carries the upgrade nudge),
    // 403/404 gone. The server's wording beats a generic failure every time.
    return { saved: 0, cancelled: 0, total: 0, error: body.error ?? "Couldn't download." };
  }

  const items: DownloadItem[] =
    body.items && body.items.length > 0
      ? body.items
      : body.url
        ? [{ url: body.url, kind: "video", filename: body.filename ?? "frenz" }]
        : [];

  if (items.length === 0) return { saved: 0, cancelled: 0, total: 0, error: "Nothing to download here." };

  let saved = 0;
  let cancelled = 0;
  for (const [i, item] of items.entries()) {
    onProgress?.(i, items.length);
    /*
      Sequential, not Promise.all: each save can raise a share sheet, and five
      at once is unusable on iOS. It also avoids holding several multi-megabyte
      blobs in memory at the same time on a phone. Albums are a handful of
      items, so wall-clock time is not the constraint here.
    */
    const result = await saveMediaToDevice({
      url: item.url,
      // 🔴 Per item, from the server. This is the line whose absence turned
      // every feed photo into an unopenable "video".
      kind: item.kind === "image" ? "image" : "video",
      filename: item.filename,
    });
    if (result === "saved" || result === "shared") saved += 1;
    else if (result === "cancelled") cancelled += 1;
  }
  onProgress?.(items.length, items.length);

  return { saved, cancelled, total: items.length };
}

/**
 * Save a post's media, with toasts. The signature is unchanged so the feed
 * card, the image viewer, the post viewer and the reel viewer all keep calling
 * it exactly as they did.
 *
 * `mediaUrl` is now only used to fail fast on a post with no media at all — the
 * URLs that actually get saved come from the server, which is what makes albums
 * and mixed-kind posts work.
 */
export async function downloadPost(item: {
  id: string;
  mediaUrl?: string | null;
  title?: string;
  thumbnailUrl?: string | null;
}): Promise<void> {
  if (!item.mediaUrl) {
    toast("Nothing to download here.", "error");
    return;
  }

  const tid = toast("Saving…", "loading");
  const result = await savePostMedia(item.id, (done, total) => {
    if (total > 1) toast(`Saving ${Math.min(done + 1, total)} of ${total}…`, "loading", { id: tid });
  });

  if (result.error) {
    toast(result.error, "error", { id: tid, duration: result.error.includes("Pro") ? 6000 : 4000 });
    if (result.error.toLowerCase().includes("sign in")) window.location.href = "/login?next=/home";
    return;
  }

  if (result.saved === 0) {
    // A dismissed share sheet is the person saying no, not a failure — saying
    // "Saved" there, or "Couldn't save", would both be wrong.
    if (result.cancelled > 0) dismissToast(tid);
    else toast("Couldn't save that.", "error", { id: tid });
    return;
  }

  toast(
    result.total > 1 ? `Saved ${result.saved} of ${result.total} to your device` : "Saved to your device",
    "success",
    { id: tid },
  );
}
