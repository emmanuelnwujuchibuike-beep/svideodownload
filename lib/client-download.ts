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
/**
 * Hand SEVERAL finished files to the device in one gesture.
 *
 * iOS is the case that matters: `navigator.share` takes an array, so a whole
 * batch (every snap of a Snapchat story, every photo of a slideshow) goes into
 * ONE share sheet and lands in Photos in a single action — instead of one tap,
 * one sheet and one dismissal per file.
 *
 * Elsewhere it falls back to individual anchor saves with a gap between them,
 * because browsers silently drop all but the first `<a download>` fired in a
 * tight loop.
 *
 * Returns true when the files were handed over, false when the visitor
 * cancelled — the caller uses that to decide whether to clear its pending state,
 * so a cancelled sheet leaves the buttons intact rather than losing the files.
 */
export async function saveFilesToDevice(
  items: { blob: Blob; filename: string }[],
): Promise<boolean> {
  if (items.length === 0) return false;
  if (items.length === 1) {
    await saveToDevice(items[0]!.blob, items[0]!.filename);
    return true;
  }

  const files = items.map(
    (i) =>
      new File([i.blob], safeDownloadFilename(i.filename), {
        type: i.blob.type || mimeForExtension(i.filename),
      }),
  );

  if (typeof navigator.share === "function") {
    try {
      // `canShare` is the only reliable way to know the platform will accept a
      // multi-file payload; some accept one file but not many.
      if (!navigator.canShare || navigator.canShare({ files })) {
        await navigator.share({ files });
        return true;
      }
    } catch (e) {
      // Cancelled — the files are untouched and still waiting.
      if (e instanceof Error && e.name === "AbortError") return false;
      // Anything else falls through to the per-file path below.
    }
  }

  // Serialised anchor saves — a tight loop would drop all but the first.
  for (const [index, file] of files.entries()) {
    setTimeout(() => saveBlob(file, file.name), index * 700);
  }
  return true;
}

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
