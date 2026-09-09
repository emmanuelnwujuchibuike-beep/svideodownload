import { NextResponse } from "next/server";

import { cleanedFileName } from "@/lib/ai/clean-media";
import { aiFeature } from "@/lib/ai/jobs";
import { aiErrorBody, aiErrorStatus, isAiJobError } from "@/lib/ai/errors";
import { getOwnJob } from "@/lib/ai/job-store";
import { pathBelongsTo } from "@/lib/ai/storage";
import { signResultUrl } from "@/lib/ai/storage-server";
import { aiJobReadLimiter } from "@/lib/rate-limit";
import { subjectOwnerId } from "@/lib/ai/subject";
import { applyAiSubjectCookie, resolveAiSubject } from "@/lib/ai/subject-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/jobs/[id]/result — a short-lived link to the cleaned video.
 *
 * ── 🔴 A SIGNED URL IS AUTHORITY OVER A FILE ─────────────────────────────────
 *
 * The private bucket has no read policy, so this endpoint is the only way in —
 * which makes every check here load-bearing rather than defensive:
 *
 *   1. there is a session;
 *   2. the job is THIS member's (read as them, so RLS decides, plus an id
 *      filter);
 *   3. the job is genuinely `completed` — a queued or failed job has nothing to
 *      hand over, and saying so beats signing a path that holds no file;
 *   4. the stored path really belongs to this member and this job. The path
 *      comes from the row, not the request, and this is the second check on
 *      the same fact — the one that still holds if a bad write ever put a
 *      foreign key in a row.
 *
 * The link expires in minutes (AI_SIGNED_URL_TTL_SECONDS), so one pasted into a
 * chat or captured in a log stops working before it can be passed around. The
 * member can always ask for another.
 *
 * `no-store`, because a cached signed URL outlives the reason it was issued.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const feat = aiFeature("ai_clean");
  if (!feat) {
    return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), {
      status: aiErrorStatus("FEATURE_UNAVAILABLE"),
    });
  }
  // A guest owns their result exactly as a member does — see the note in
  // lib/ai/job-store.ts on why the signed cookie replaces RLS here.
  const resolution = await resolveAiSubject(request, feat.id);
  const { subject } = resolution;

  /*
    🔴 SIGNED IN, OR NOTHING (owner, 2026-09-09, standing Frenz AI rule).

    "Only authenticated/signed-in users can access Frenz AI. Logged-out users
    must not be able to open or use AI tools." `resolveAiSubject` returns null
    for anyone without a session, and the check lives in EVERY route rather
    than in a shared wrapper because §21 requires the backend to enforce this
    independently — a wrapper is one refactor away from being bypassed on one
    route and nobody noticing.

    AUTH_REQUIRED is 401: this is "sign in", not "you may not".
  */
  if (!subject) {
    return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  }

  const burst = await aiJobReadLimiter.limit(`ai-result:${subject.key}`);
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
    // Somebody else's job answers exactly as a job that does not exist.
    if (!job) {
      return NextResponse.json(aiErrorBody("JOB_NOT_FOUND"), { status: aiErrorStatus("JOB_NOT_FOUND") });
    }

    if (job.status === "expired") {
      return NextResponse.json(aiErrorBody("JOB_NOT_FOUND", { error: "That video has expired." }), {
        status: aiErrorStatus("JOB_NOT_FOUND"),
      });
    }
    if (job.status !== "completed" || !job.result_path) {
      return NextResponse.json(
        aiErrorBody("JOB_NOT_FOUND", { error: "That video isn't ready yet." }),
        { status: 409 },
      );
    }

    if (!pathBelongsTo(job.result_path, subjectOwnerId(subject), job.id)) {
      console.error("[ai/result] stored path failed ownership", { jobId: job.id, subject: subject.key });
      return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
    }

    /*
      ── 🔴 `?download=1` IS WHAT MAKES SAVING WORK ────────────────────────

      Without it the panel got a bare signed URL and used `<a download>`, and
      browsers ignore that attribute across origins — a Supabase URL is a
      different origin, so the video opened and played and nothing was saved.
      Asking storage for a `Content-Disposition` fixes it at the source, with
      no video passing through this function.

      The filename comes from the member's own upload, via the same helper the
      panel uses, so the saved file is named the way the screen says it is.
    */
    const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
    const sourceName =
      typeof job.metadata?.source_name === "string" ? job.metadata.source_name : null;
    const signed = await signResultUrl(
      job.result_path,
      wantsDownload ? cleanedFileName(sourceName) : undefined,
    );

    /*
      ── 🔴 `&redirect=1` MAKES THIS A REAL DOWNLOAD TARGET ───────────────────

      Owner, 2026-09-08: "the frenz ai result video downloads like this" — with
      a screenshot of Safari showing a supabase.co file-preview page and "Open
      in WA Business", rather than a saved file. Handing the browser a foreign
      URL takes the member OFF the site, which is not what a download feels
      like anywhere else in this app.

      With this flag the route 302s to the freshly-signed URL instead of
      returning it as JSON, which buys three things at once:

        · the member navigates to OUR origin, so it behaves like every other
          download here;
        · the `Content-Disposition` on the final response is what the browser
          obeys, so the file saves rather than previews;
        · the url is STABLE — it re-signs on every request — so it can be
          stored in download history and still work tomorrow, which a signed
          url expiring in minutes could never do.

      No video passes through this function either way: the redirect is a
      header, and storage still serves the bytes.
    */
    if (wantsDownload && new URL(request.url).searchParams.get("redirect") === "1") {
      return NextResponse.redirect(signed.url, {
        status: 302,
        // A signed url must never be cached by anything between us and them.
        headers: { "cache-control": "no-store" },
      });
    }
    return NextResponse.json(
      { url: signed.url, expiresIn: signed.expiresIn, size: job.result_size },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    if (isAiJobError(e)) {
      return NextResponse.json(aiErrorBody(e.code), { status: aiErrorStatus(e.code) });
    }
    console.error("[ai/result] threw", { subject: subject.key, jobId: id, error: String(e) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
