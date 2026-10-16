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
  direct = false,
  transform,
  onProgress,
  onNeedsTap,
}: {
  url: string;
  kind: "image" | "video";
  filename?: string | null;
  /**
   * Fetch `url` itself, never through the storage proxy — for a file a Frenz
   * service makes on request (the worker's watermarked video, which answers
   * CORS for the site's origins). Not a storage object, so the proxy can't fetch it.
   */
  direct?: boolean;
  /** Rewrites the bytes before they are saved (the photo watermark). */
  transform?: (blob: Blob) => Promise<Blob>;
  /** Bytes received so far — the fraction, when the response says how big it is. */
  onProgress?: (fraction: number | null) => void;
  /**
   * iOS refused the share sheet because the tap's permission was spent while the
   * file was being fetched (a watermarked video takes a while). Ask for ONE more
   * tap and run `share` inside it — the file is ready by then. Without this the
   * save falls back to a blob link, which an iOS web app opens as a Quick Look
   * page (owner, 2026-10-15: "it shouldn't be downloading like this, it should be
   * downloading in the app").
   */
  onNeedsTap?: (share: () => Promise<SaveResult>) => Promise<SaveResult>;
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
    const res = direct
      ? await fetch(url, { mode: "cors", cache: "no-store", credentials: "omit" })
      : ((await fetchDirect(url)) ?? (await fetch(proxiedUrl(url, name), { cache: "no-store" })));
    if (!res.ok) return "failed";
    const fetched = await readWithProgress(res, onProgress);
    const blob = transform ? await transform(fetched) : fetched;
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
        // the tap was spent on the wait: one more tap opens the sheet, in the app
        if (e instanceof DOMException && e.name === "NotAllowedError" && onNeedsTap) {
          return onNeedsTap(async () => {
            try {
              await nav.share({ files: [file] });
              return "shared";
            } catch (err) {
              return err instanceof DOMException && err.name === "AbortError" ? "cancelled" : "failed";
            }
          });
        }
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

/**
 * The response body as a blob, reporting how much has arrived. Without a size
 * (no Content-Length) it reports null once, so the caller shows a plain
 * "Downloading…"; without a stream reader it is just `res.blob()`.
 */
async function readWithProgress(res: Response, onProgress?: (fraction: number | null) => void): Promise<Blob> {
  const total = Number(res.headers.get("content-length")) || 0;
  if (!onProgress || !res.body || typeof res.body.getReader !== "function") return res.blob();
  if (!total) {
    onProgress(null);
    return res.blob();
  }
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let got = 0;
  let shown = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    // whole percents only, so a fast connection doesn't re-render the toast for every chunk
    const pct = Math.min(100, Math.floor((got / total) * 100));
    if (pct !== shown) {
      shown = pct;
      onProgress(pct / 100);
    }
  }
  return new Blob(chunks, { type: res.headers.get("content-type") ?? "" });
}
