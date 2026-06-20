/**
 * Frontend/worker split.
 *
 * The same app runs in two roles, decided purely by env:
 *  - FRONTEND (Vercel): `DOWNLOAD_WORKER_URL` is set, so heavy routes
 *    (/api/metadata, /api/download) forward to the worker instead of running
 *    yt-dlp/ffmpeg locally (which Vercel's serverless runtime lacks).
 *  - WORKER (Docker on Fly/Railway/etc.): `DOWNLOAD_WORKER_URL` is unset, so it
 *    does the real extraction/download. If `WORKER_SECRET` is set it requires a
 *    matching `x-worker-secret` header so only the trusted frontend can use it.
 */

export const WORKER_URL = (process.env.DOWNLOAD_WORKER_URL || "").replace(/\/$/, "");
export const WORKER_SECRET = process.env.WORKER_SECRET || "";

/** True on the FRONTEND role: requests should be proxied to the worker. */
export const hasWorker = WORKER_URL.length > 0;

/**
 * On the WORKER role, rejects requests lacking the shared secret. Returns an
 * error Response to short-circuit, or null when the request may proceed.
 * No-op on the frontend (which is the one sending the secret).
 */
export function rejectIfUnauthorizedWorker(request: Request): Response | null {
  // Only enforce when we ARE the worker (not proxying) and a secret is set.
  if (hasWorker || !WORKER_SECRET) return null;
  if (request.headers.get("x-worker-secret") === WORKER_SECRET) return null;
  return new Response(
    JSON.stringify({ error: "Forbidden", code: "INTERNAL" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

/** Forwards a JSON POST body to the worker and returns its streamed response. */
export async function proxyToWorker(
  path: "/api/metadata" | "/api/download",
  body: unknown,
  clientIp: string,
): Promise<Response> {
  const upstream = await fetch(`${WORKER_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-worker-secret": WORKER_SECRET,
      // Preserve the real client IP so the worker's rate limiter is accurate.
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify(body),
  });

  // Stream the worker's response straight back, copying the headers that matter.
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-disposition", "cache-control", "retry-after"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
