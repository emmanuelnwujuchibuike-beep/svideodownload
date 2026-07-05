"use client";

import { toast } from "@/features/ui/toast";
import { FrenzsaveError } from "@/lib/sdk";
import { getApi } from "@/lib/sdk/browser";

/**
 * Download a post's media directly (from the feed, reels, anywhere). Goes through
 * the shared SDK — the exact same client + endpoint the native/desktop apps use —
 * which authorizes it (enforcing the free daily cap) and returns the media URL +
 * filename. We then fetch the file and save it, falling back to opening it in a
 * new tab if a CORS policy blocks the blob fetch.
 */
export async function downloadPost(item: { id: string; mediaUrl?: string | null; title?: string }): Promise<void> {
  if (!item.mediaUrl) {
    toast("Nothing to download here.", "error");
    return;
  }
  const tid = toast("Preparing download…", "loading");
  try {
    const data = await getApi().authorizeDownload(item.id);
    const filename = data.filename || "frenz-video.mp4";
    try {
      const fileRes = await fetch(data.url, { mode: "cors" });
      if (!fileRes.ok) throw new Error();
      const blob = await fileRes.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
    } catch {
      // CORS or network blocked the blob fetch → open it so the user can save it.
      window.open(data.url, "_blank", "noopener");
    }
    const left = typeof data.remaining === "number" ? ` · ${data.remaining} free left today` : "";
    toast(`Saved${left}`, "success", { id: tid });
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
