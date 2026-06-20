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
