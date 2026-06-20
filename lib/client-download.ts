import type { ApiError, MediaKind } from "@/types";

export interface DownloadPayload {
  url: string;
  formatId: string;
  kind: MediaKind;
  title?: string;
}

export type DownloadOutcome = { ok: true } | { ok: false; error: string };

/** Saves a blob to the user's disk via a transient object URL. */
function saveBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

/**
 * Requests a download from the API and saves the resulting file. Shared by the
 * main downloader and the history panel's "re-download" action.
 */
export async function downloadToDisk(
  payload: DownloadPayload,
): Promise<DownloadOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, error: "Network error. Please try again." };
  }

  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as ApiError | null;
    return { ok: false, error: json?.error ?? "Download failed." };
  }

  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename =
    match?.[1] || `download.${payload.kind === "audio" ? "mp3" : "mp4"}`;
  saveBlob(blob, filename);
  return { ok: true };
}
