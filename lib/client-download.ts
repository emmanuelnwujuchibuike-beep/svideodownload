import type { MediaKind } from "@/types";

export interface DownloadPayload {
  url: string;
  formatId: string;
  kind: MediaKind;
  title?: string;
}

/** Builds the browser-navigable download URL for a payload. */
export function downloadUrl(payload: DownloadPayload): string {
  const params = new URLSearchParams({
    url: payload.url,
    formatId: payload.formatId,
    kind: payload.kind,
  });
  if (payload.title) params.set("title", payload.title);
  return `/api/download?${params.toString()}`;
}

/**
 * Triggers a download via the browser's NATIVE download manager by navigating a
 * link to the GET download endpoint (which responds with
 * `Content-Disposition: attachment`).
 *
 * This replaces the old fetch()+Blob approach, which iOS Safari silently
 * ignores (the request finishes but no file is ever saved). A real navigation
 * works across iOS, Android and desktop.
 */
export function downloadToDisk(payload: DownloadPayload): void {
  const a = document.createElement("a");
  a.href = downloadUrl(payload);
  a.download = "";
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Remove on the next tick so the click/navigation is registered first.
  setTimeout(() => a.remove(), 0);
}

/** Saves an already-fetched Blob to disk (used by the in-app download manager). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "download";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

/** iOS (incl. iPadOS-as-Mac) — where in-app anchor saves are unreliable. */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Hand a finished file to the DEVICE the premium way per platform. On iOS the
 * share sheet is the real path to "Save Video"/Photos/Files — but it requires
 * a user gesture, so call this from a button tap (the download-complete card),
 * never from an async completion. Falls back to the anchor save.
 */
export async function saveToDevice(blob: Blob, filename: string): Promise<void> {
  const safe = filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "download";
  if (isIosDevice() && typeof navigator.share === "function") {
    try {
      const file = new File([blob], safe, { type: blob.type || "application/octet-stream" });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      // User closed the sheet — done. Anything else → anchor fallback below.
      if (e instanceof Error && e.name === "AbortError") return;
    }
  }
  saveBlob(blob, safe);
}
