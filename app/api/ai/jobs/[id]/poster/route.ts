import { NextResponse } from "next/server";

import { aiFeature } from "@/lib/ai/jobs";
import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { getOwnJob } from "@/lib/ai/job-store";
import { pathBelongsTo } from "@/lib/ai/storage";
import { readResultPoster } from "@/lib/ai/storage-server";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  GET /api/ai/jobs/[id]/poster — the still frame on a history tile
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: the AI history should look like the download history. The
 * difference between the two screenshots was that download tiles are pictures
 * of your video and AI tiles were coloured plates. This is where the picture
 * comes from.
 *
 * ── 🔴 THE BYTES GO THROUGH HERE, AND THAT IS DELIBERATE ────────────────────
 *
 * Every other route in this folder hands back a SIGNED URL and lets storage
 * serve the file, under a standing rule against pulling media through a
 * function that bills by the millisecond. That rule is about VIDEOS. A poster
 * is the case it does not cover, because of what it is attached to — a list:
 *
 *   · A signed URL is a different URL every time it is minted, and this list
 *     polls itself while a job runs. Signed posters would change every tile's
 *     `<img src>` every few seconds and re-download a picture the browser
 *     already had, forever. This path never changes, so the browser caches it.
 *   · Signed URLs expire in ten minutes. A history page left open would turn
 *     into a wall of broken images.
 *   · A 302 to a signed URL fixes neither: the redirect still has to be
 *     re-issued, and Safari will not cache one to a URL that keeps changing.
 *
 * The exposure is bounded by the file rather than by judgement: tens of
 * kilobytes, `immutable` for a day, so it is fetched once per job per browser.
 *
 * ── The same four checks the result route makes ─────────────────────────────
 *
 * A poster is a frame of somebody's video, so it is guarded exactly as the
 * video is: there is a subject, the job is theirs (read through `getOwnJob`, so
 * RLS decides for a member and the signed cookie for a guest), the row actually
 * holds a poster, and the stored path proves it belongs to this owner and this
 * job. Somebody else's job answers 404, identically to one that does not exist.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feat = aiFeature("ai_clean");
  if (!feat) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), {
      status: aiErrorStatus("FEATURE_UNAVAILABLE"),
    });
  }

  const { subject } = await resolveAiSubject(request, feat.id);

  const burst = await aiJobReadLimiter.limit(`ai-poster:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  const { id } = await params;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
  }

  try {
    const job = await getOwnJob(subject, id);
    if (!job?.poster_path) {
      return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), {
        status: aiErrorStatus("JOB_NOT_FOUND"),
      });
    }

    if (!pathBelongsTo(job.poster_path, subjectOwnerId(subject), job.id)) {
      console.error("[ai/poster] stored path failed ownership", { jobId: job.id, subject: subject.key });
      return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
    }

    const body = await readResultPoster(job.poster_path);
    /*
      A missing object is a 404, not a 500. The retention sweep deletes posters
      on its own schedule, so a tile can genuinely ask for one that has just
      gone — the `<img>` fails, the tile falls back to its plate, and nothing
      about that is an error worth a log line.
    */
    if (!body) {
      return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), {
        status: aiErrorStatus("JOB_NOT_FOUND"),
      });
    }

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(body.byteLength),
        /*
          🔴 `private`, never `public`. This is one member's video frame, and a
          shared cache — a CDN, a corporate proxy — holding it under a URL that
          carries no identity is how one person's poster reaches another's
          browser. `immutable` is honest here in a way it usually is not: a
          poster is cut once from a file that never changes, and the row's own
          retention deletes it rather than replacing it.
        */
        "Cache-Control": "private, max-age=86400, immutable",
        // The bytes are already unguessable and access-checked; this is here so
        // a poster can never be interpreted as anything but an image.
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/poster] threw", { jobId: id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
