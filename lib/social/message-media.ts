/**
 * Media-messaging constants — kept client-safe (no Supabase import), same
 * convention as message-meta.ts, so both the composer (validates before
 * upload) and the API route (re-validates server-side, never trusts the
 * client) share one definition instead of two that could drift.
 *
 * Deliberately excludes APK/executable files from the document allowlist —
 * a chat app has no real justification for letting members exchange
 * installable binaries, unlike the spec's own "APK Files (Optional)" note.
 */
export type AttachmentKind = "image" | "video" | "audio" | "document";

export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

export const MAX_SIZE_BYTES: Record<AttachmentKind, number> = {
  image: 25 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  document: 50 * 1024 * 1024,
};

export const ALLOWED_MIME: Record<AttachmentKind, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  audio: ["audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/wav", "audio/x-m4a"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip",
    "application/x-zip-compressed",
    "application/x-rar-compressed",
    "text/plain",
    "text/csv",
  ],
};

export function attachmentKindForMime(mime: string): AttachmentKind | null {
  for (const kind of Object.keys(ALLOWED_MIME) as AttachmentKind[]) {
    if (ALLOWED_MIME[kind].includes(mime)) return kind;
  }
  return null;
}

export function isAllowedMime(kind: AttachmentKind, mime: string): boolean {
  return ALLOWED_MIME[kind].includes(mime);
}

export function extForFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "bin" : filename.slice(dot + 1).toLowerCase().slice(0, 5);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
