"use client";

/**
 * Save a piece of media the viewer can already see to their device's storage.
 *
 * Owner (2026-07-16): "make way users can save media sent to them in chat to
 * phone media storage."
 *
 * Deliberately NOT the `/api/download` + yt-dlp path `PostDownloadButton` uses:
 * that exists to re-extract from a THIRD-PARTY source URL on demand (we host
 * nothing there). Chat attachments are already our own storage objects, so
 * re-extraction would be meaningless — this fetches the object and hands it to
 * the OS.
 *
 * Two paths, because "save to phone storage" genuinely differs by platform:
 *
 *  1. The Web Share API with a file. This is the ONLY route that reaches the
 *     iOS Photos library — `<a download>` is ignored by iOS Safari for
 *     cross-origin URLs (it navigates or opens a preview instead), so a
 *     download attribute alone would silently not save anything on the exact
 *     platform this was asked for. The share sheet surfaces "Save Image" /
 *     "Save to Files".
 *  2. `<a download>` from a blob URL — the normal desktop/Android path, which
 *     lands in the Downloads folder.
 *
 * Returns what actually happened so the caller can be honest in its toast
 * rather than claiming a save that may not have occurred: the share sheet can
 * be dismissed, and "shared" is not "saved".
 */
export type SaveResult = "saved" | "shared" | "cancelled" | "failed";

/** The origins storage CORS was measured to answer (see the note in saveMediaToDevice). */
const DIRECT_ORIGINS = new Set(["https://frenzsave.com", "https://www.frenzsave.com"]);

export function proxiedUrl(url: string, name: string): string {
  return `/api/media/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`;
}

/**
 * The object straight from storage, or null to use the proxy — off the
 * production origins (where it would throw), for a non-https URL, or when the
 * direct attempt failed in any way.
 */
async function fetchDirect(url: string): Promise<Response | null> {
  if (typeof location === "undefined" || !DIRECT_ORIGINS.has(location.origin)) return null;
  if (!/^https:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { mode: "cors", cache: "no-store", credentials: "omit" });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

function extensionFor(url: string, mime: string | null, kind: "image" | "video"): string {
  const fromUrl = url.split("?")[0]?.split(".").pop()?.toLowerCase();
  if (fromUrl && /^[a-z0-9]{2,4}$/.test(fromUrl)) return fromUrl;
  if (mime?.includes("/")) {
    const sub = mime.split("/")[1]?.split(";")[0];
    if (sub && /^[a-z0-9]{2,4}$/.test(sub)) return sub;
  }
  return kind === "video" ? "mp4" : "jpg";
}

export async function saveMediaToDevice({
  url,
  kind,
  filename,
}: {
  url: string;
  kind: "image" | "video";
  filename?: string | null;
}): Promise<SaveResult> {
  try {
    const ext = extensionFor(url, null, kind);
    const name = filename?.trim() || `frenz-${Date.now()}.${ext}`;

    // Fetch through OUR OWN origin, never the storage host directly.
    //
    // Measured, not assumed (owner report "couldn't save that"):
    // `media.frenzsave.com` reflects CORS for `https://frenzsave.com` and
    // `https://www.frenzsave.com` only — a Vercel preview or local dev origin
    // gets no `access-control-allow-origin` at all, so a direct fetch THROWS
    // and every save fails there. Same-origin has no preflight and no
    // per-domain allowlist to keep in sync. See /api/media/download.
    //
    // 🔴 FOT brief (owner, 2026-10-06): the proxy streams every saved byte
    // through Vercel. On the two production origins that measurement says the
    // direct fetch WORKS, so it is tried first there and the proxy is only
    // the fallback. Nothing is loosened: the URL is one the page already
    // shows (a public object), and the bytes still become a same-origin blob
    // below, so `Content-Disposition` was never what saved it.
    const res = (await fetchDirect(url)) ?? (await fetch(proxiedUrl(url, name), { cache: "no-store" }));
    if (!res.ok) return "failed";
    const blob = await res.blob();
    const file = new File([blob], name, { type: blob.type || (kind === "video" ? "video/mp4" : "image/jpeg") });

    // 1. Share sheet — the only path to the iOS Photos library.
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file] });
        return "shared";
      } catch (e) {
        // A dismissed share sheet throws AbortError — that's the user saying
        // no, not a failure, and must not fall through to a second attempt
        // that pops a download they didn't ask for.
        if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
        // NotAllowedError lands here and is EXPECTED on iOS: `navigator.share`
        // must be called inside the user gesture, and the `await fetch` above
        // has already spent it. There is no way to have both the bytes and the
        // gesture, so the download path below is the real fallback, not an edge
        // case — which is exactly why the proxy sets Content-Disposition:
        // attachment, so that path actually saves instead of navigating.
      }
    }

    // 2. Blob download — desktop/Android.
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick — revoking synchronously can cancel the download
    // in some browsers before it has actually started reading the blob.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    return "saved";
  } catch {
    return "failed";
  }
}
