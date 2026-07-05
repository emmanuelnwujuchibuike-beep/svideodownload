"use client";

import { toast } from "@/features/ui/toast";

/**
 * Download a post's media directly (from the feed, reels, anywhere). The server
 * authorizes it — enforcing the free daily cap and returning the media URL +
 * filename — then we fetch the file and save it, with a graceful fallback to
 * opening it in a new tab if the blob fetch is blocked by CORS.
 */
export async function downloadPost(item: { id: string; mediaUrl?: string | null; title?: string }): Promise<void> {
  if (!item.mediaUrl) {
    toast("Nothing to download here.", "error");
    return;
  }
  const tid = toast("Preparing download…", "loading");
  try {
    const res = await fetch(`/api/posts/${item.id}/download`, { method: "POST" });
    let data: { url?: string; filename?: string; remaining?: number | null; error?: string; upgrade?: boolean } = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON */
    }

    if (res.status === 401) {
      toast("Sign in to download.", "error", { id: tid });
      window.location.href = "/login?next=/home";
      return;
    }
    if (res.status === 402) {
      toast(data.error ?? "Free download limit reached — go Pro for unlimited.", "error", { id: tid, duration: 6000 });
      return;
    }
    if (!res.ok || !data.url) {
      toast(data.error ?? "Couldn't download.", "error", { id: tid });
      return;
    }

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
  } catch {
    toast("Couldn't download.", "error", { id: tid });
  }
}
