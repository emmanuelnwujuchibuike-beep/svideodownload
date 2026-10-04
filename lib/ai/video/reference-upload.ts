/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  UPLOADING A REFERENCE — ticket, PUT, confirm
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three calls, and the big one does not touch our server:
 *
 *   1. POST  /api/ai/video/reference   → { uploadUrl, path }
 *   2. PUT   uploadUrl                 → the bytes, straight to storage
 *   3. PATCH /api/ai/video/reference   → the object is checked, { url } back
 *
 * 🔴 Step 2 is why this exists. A reference video may be 200 MB; sending that
 * through a route handler would exceed the platform's request-body ceiling,
 * bill every byte twice as Fast Origin Transfer, and hold it all in memory.
 * The browser talks to storage directly, and our server only ever moves JSON.
 *
 * Step 3 is not bookkeeping — it is the gate. Step 1 could only check what the
 * browser CLAIMED the file was; step 3 reads what actually landed and refuses
 * on its true size and type, before anything is priced.
 */

export type ReferenceKind = "image" | "video";

export interface UploadedReference {
  /** The URL Kling will fetch. */
  url: string;
  /** The storage key, so a later step can refer to the same object. */
  path: string;
}

/** A sentence for the member. Thrown rather than returned so a caller cannot ignore it. */
export class ReferenceUploadError extends Error {}

async function readProblem(res: Response, fallback: string): Promise<string> {
  const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof json?.error === "string" && json.error ? json.error : fallback;
}

export async function uploadReference(
  file: File,
  kind: ReferenceKind,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<UploadedReference> {
  const ticketRes = await fetch("/api/ai/video/reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, contentType: file.type, size: file.size }),
    signal: opts.signal,
  });
  if (!ticketRes.ok) throw new ReferenceUploadError(await readProblem(ticketRes, "That file couldn't be accepted."));
  const ticket = (await ticketRes.json()) as { uploadUrl: string; path: string };

  await putWithProgress(ticket.uploadUrl, file, opts);

  const doneRes = await fetch("/api/ai/video/reference", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, path: ticket.path }),
    signal: opts.signal,
  });
  if (!doneRes.ok) throw new ReferenceUploadError(await readProblem(doneRes, "That upload didn't finish. Try again."));
  const done = (await doneRes.json()) as { url: string; path: string };
  return { url: done.url, path: done.path };
}

/**
 * The PUT.
 *
 * 🔴 `XMLHttpRequest`, not `fetch`, and only for one reason: upload progress.
 * `fetch` has no upload-progress event in any shipping browser, and a 200 MB
 * video on a phone connection with no progress bar is indistinguishable from a
 * frozen app — the member cancels and retries, paying for the bytes twice.
 */
function putWithProgress(url: string, file: File, opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("content-type", file.type);
    // The ticket is minted with upsert, so a retry overwrites its own object
    // rather than failing on a duplicate key.
    xhr.setRequestHeader("x-upsert", "true");

    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts.onProgress) opts.onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ReferenceUploadError("That file couldn't be uploaded. Check your connection and try again."));
    };
    xhr.onerror = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new ReferenceUploadError("That file couldn't be uploaded. Check your connection and try again."));
    };
    xhr.onabort = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new ReferenceUploadError("Upload cancelled."));
    };
    xhr.send(file);
  });
}
