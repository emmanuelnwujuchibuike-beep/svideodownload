import { getClient } from "@/lib/supabase/client-lazy";

/**
 * The browser's door to the download worker — previews and files with no
 * Vercel hop (owner, 2026-10-08: "fix the vercel issue, so vercel doesn't
 * consume … the speed is what needs attention").
 *
 * Measured on production that day, before this: every download made a Vercel
 * ticket call (0.8–1.9 s) and every preview went through a Vercel proxy, before
 * the worker did any real work. Now both go straight to the worker, which runs
 * every check itself (app/api/download/route.ts → browserDirectDownload).
 *
 * Requests are CORS "simple" (`text/plain`, no custom header), so there is no
 * preflight round trip. The member's access token rides in the body.
 *
 * `NEXT_PUBLIC_DOWNLOAD_ORIGIN` points this at another host — a Cloudflare-
 * fronted name such as dl.frenzsave.com once its DNS exists — without a code
 * change. `NEXT_PUBLIC_DOWNLOAD_DIRECT=0` is the kill switch back to the
 * same-origin routes.
 */
export const DOWNLOAD_ORIGIN = (process.env.NEXT_PUBLIC_DOWNLOAD_ORIGIN || "https://svideodownload-worker-production.up.railway.app").trim().replace(/\/$/, "");

export function workerDirectEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DOWNLOAD_DIRECT !== "0";
}

const SIMPLE = { "Content-Type": "text/plain;charset=UTF-8" } as const;

/** The signed-in member's access token, read locally (no request); null when signed out. */
async function accessToken(): Promise<string | null> {
  try {
    const supabase = await getClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * A worker that predates the direct path refuses a secret-less call with 403
 * `{"code":"INTERNAL"}`. During a deploy the site can go live minutes before
 * the worker does (measured 2026-10-08), so that one answer means "use the old
 * door this time" — and the moment the new worker is up, the direct path takes
 * over by itself. Any other answer is the worker's own and is returned as-is.
 */
export function isOldWorkerRefusal(res: Response): boolean {
  return res.status === 403 && !(res.headers.get("access-control-allow-origin") ?? "");
}

function sameOriginMetadata(url: string, signal?: AbortSignal): Promise<Response> {
  return fetch("/api/metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), signal });
}

/** POST /api/metadata — the preview. Same JSON answer as the old same-origin route. */
export async function postMetadata(url: string, signal?: AbortSignal): Promise<Response> {
  if (!workerDirectEnabled()) return sameOriginMetadata(url, signal);
  try {
    const res = await fetch(`${DOWNLOAD_ORIGIN}/api/metadata`, { method: "POST", headers: SIMPLE, body: JSON.stringify({ url }), signal, mode: "cors", credentials: "omit" });
    return isOldWorkerRefusal(res) ? sameOriginMetadata(url, signal) : res;
  } catch (e) {
    if (signal?.aborted) throw e;
    // An old worker's 403 carries no CORS header, so the browser reports it as a
    // network error, not a 403 — the same compatibility door applies.
    return sameOriginMetadata(url, signal);
  }
}

/**
 * A same-origin `/api/download?…` target → the worker's direct request body.
 * The query is the download manager's own vocabulary (url, formatId, kind,
 * title, t, b, hevc, rewardToken, itemIndex); nothing else is forwarded.
 */
export function directDownloadBody(target: string, token: string | null): Record<string, unknown> {
  const sp = new URL(target, "https://x.invalid").searchParams;
  const body: Record<string, unknown> = {};
  for (const k of ["url", "formatId", "kind", "title", "t", "b", "rewardToken", "itemIndex"]) {
    const v = sp.get(k);
    if (v !== null) body[k] = v;
  }
  if (sp.get("hevc") === "1") body.hevc = true;
  if (token) body.accessToken = token;
  return body;
}

/** POST /api/download on the worker: the checks and the file in ONE response. */
export async function postDirectDownload(target: string, signal: AbortSignal): Promise<Response> {
  const body = directDownloadBody(target, await accessToken());
  return fetch(`${DOWNLOAD_ORIGIN}/api/download`, { method: "POST", headers: SIMPLE, body: JSON.stringify(body), signal, mode: "cors", credentials: "omit" });
}
