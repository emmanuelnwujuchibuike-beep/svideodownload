import "server-only";

import { hasWorker, WORKER_SECRET, WORKER_URL } from "@/lib/worker";
import type { VideoInspectOutcome } from "@/server/services/ai-video-inspect-service";

/**
 * Ask the WORKER to inspect a reference video (ffprobe facts, optionally the
 * people in it). Vercel has neither ffprobe nor the models.
 *
 * A worker that cannot answer — none configured, unreachable, or an older
 * deploy without this route (the site ships ~15 min before the worker) — is
 * "we couldn't check it just now", never a pass: these facts gate a paid edit.
 */
export type InspectDispatch = VideoInspectOutcome | { ok: false; code: "CHECKER_UNAVAILABLE"; detail: string };

export async function dispatchVideoInspect(req: { userId: string; path: string; detect: boolean }, timeoutMs = 55_000): Promise<InspectDispatch> {
  if (!hasWorker) return { ok: false, code: "CHECKER_UNAVAILABLE", detail: "no DOWNLOAD_WORKER_URL is configured" };
  try {
    const res = await fetch(`${WORKER_URL}/api/internal/ai/video-inspect`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(WORKER_SECRET ? { "x-worker-secret": WORKER_SECRET } : {}) },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as VideoInspectOutcome | null;
    if (!json || typeof json.ok !== "boolean") return { ok: false, code: "CHECKER_UNAVAILABLE", detail: `worker answered ${res.status} without an outcome` };
    return json;
  } catch (e) {
    return { ok: false, code: "CHECKER_UNAVAILABLE", detail: String(e).slice(0, 200) };
  }
}

/** The member's sentence for a failed inspection. */
export function inspectRefusal(code: string): string {
  switch (code) {
    case "TOO_LARGE":
      return "The video can be up to 200 MB.";
    case "UNREADABLE":
      return "We couldn't read this video. Try exporting it again as MP4.";
    case "NOT_FOUND":
      return "That upload didn't finish. Try attaching it again.";
    default:
      return "We couldn't check this video just now. Try again in a moment — nothing has been charged.";
  }
}
