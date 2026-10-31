/**
 * ONE DOWNLOAD, ONE ANONYMOUS ROW (owner, 2026-10-31: "the live activity now show duplicate report, one anonymous
 * Download is now showing multi").
 *
 * `/api/download` writes an anonymous `downloads` row per call (server/services/analytics.ts), and one Save tap can
 * call it more than once: the browser's direct POST to the worker, one retry of it, then the ticket path through
 * Vercel when the worker looks unreachable (features/downloads/fetch-download.ts). Every one of those attempts carries
 * the client's stable id for the download (`t`) — the same id the daily quota already uses to not charge a retry — so
 * the row is written only the first time that id is seen for that file.
 *
 * No id (an old client, a programmatic POST) → null → recorded as before. The id is untrusted, but the worst a forged
 * one can do is suppress the caller's own row.
 */
export const RECORD_ONCE_TTL_SECONDS = 30 * 60;

export function downloadRecordKey(
  downloadId: string | null | undefined,
  data: { url: string; formatId: string; kind: string },
): string | null {
  const id = (downloadId ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!id) return null;
  // bound to the file too, so one id can never hide a DIFFERENT download's row
  return `dlrec:${id}:${data.kind}:${data.formatId}:${data.url}`.slice(0, 512);
}
