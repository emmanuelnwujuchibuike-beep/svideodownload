"use client";

import { startDownload } from "@/features/downloads/manager";
import { toast } from "@/features/ui/toast";
import { FrenzsaveError } from "@/lib/sdk";
import { getApi } from "@/lib/sdk/browser";

/**
 * Download a post's media directly (from the feed, reels, anywhere). Goes through
 * the shared SDK — the exact same client + endpoint the native/desktop apps use —
 * which authorizes it (enforcing the free daily cap) and returns the media URL.
 * The transfer itself runs in the background download manager: live progress in
 * the floating card, the user never leaves the page, and on iOS the finished
 * file is handed over via the share sheet's Save (never a raw-file navigation).
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
  const tid = toast("Preparing download…", "loading");
  try {
    const data = await getApi().authorizeDownload(item.id);
    toast("Download started", "info", { id: tid, duration: 1500 });
    startDownload({
      url: item.mediaUrl,
      directUrl: data.url,
      formatId: "post",
      kind: "video",
      title: (data.filename || item.title || "frenz-video").replace(/\.\w+$/, ""),
      thumbnail: item.thumbnailUrl ?? null,
      platform: "generic",
      platformName: "Frenz",
      qualityLabel: "Original",
    });
  } catch (e) {
    if (e instanceof FrenzsaveError) {
      if (e.status === 401) {
        toast("Sign in to download.", "error", { id: tid });
        window.location.href = "/login?next=/home";
        return;
      }
      // 402 = free daily limit reached; message carries the upgrade nudge.
      toast(e.message, "error", { id: tid, duration: e.status === 402 ? 6000 : 4000 });
      return;
    }
    toast("Couldn't download.", "error", { id: tid });
  }
}
