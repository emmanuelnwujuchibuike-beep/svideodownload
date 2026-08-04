import { mimeForExtension, safeDownloadFilename } from "@/lib/download-filename";
import { isIos } from "@/lib/pwa/platform";
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

/** Saves an already-fetched Blob to disk (used by the in-app download manager). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // `safeDownloadFilename` truncates the BASE name and keeps the extension.
  // Slicing the whole string (what this used to do) cut ".jpg" down to ".jp"
  // on any long title, and a file with no valid extension can't be saved as an
  // image — see lib/download-filename.ts.
  a.download = safeDownloadFilename(filename);
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

/** iOS (incl. iPadOS-as-Mac) — where in-app anchor saves are unreliable. */
export const isIosDevice = isIos;

/**
 * Hand a finished file to the DEVICE the premium way per platform. On iOS the
 * share sheet is the real path to "Save Video"/Photos/Files — but it requires
 * a user gesture, so call this from a button tap (the download-complete card),
 * never from an async completion. Falls back to the anchor save.
 */
export async function saveToDevice(blob: Blob, filename: string): Promise<void> {
  const safe = safeDownloadFilename(filename);
  if (isIosDevice() && typeof navigator.share === "function") {
    try {
      // The MIME type is what iOS uses to decide whether the share sheet offers
      // "Save Image"/"Save Video" at all — `application/octet-stream` gets the
      // generic "File" treatment. `type` is derived from the extension when the
      // blob itself doesn't carry one, so a correctly-named file is never
      // offered as an untyped document.
      const file = new File([blob], safe, { type: blob.type || mimeForExtension(safe) });
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
