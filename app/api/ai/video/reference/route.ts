import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { KLING_OMNI } from "@/lib/ai/kling/features/capabilities";
import { AI_SOURCE_BUCKET } from "@/lib/ai/storage";
import { signSourceUrl, statSourceObject } from "@/lib/ai/storage-server";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { subjectOwnerId } from "@/lib/ai/subject";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiJobCreateLimiter, aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REFERENCE INPUTS — the bytes go STRAIGHT to storage, never through here
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `/api/ai/video/upload` posts the file to the function, which buffers it and
 * forwards it. That is fine for one phone photo and impossible for this: a
 * reference video may be **200 MB** (`KLING_OMNI.video.maxBytes`), and seven
 * reference images may be 70 MB together.
 *
 * Three separate reasons it must not go through a function, any one of which
 * would be enough:
 *
 *   1. It would not work. A Vercel function has a request-body ceiling far
 *      below these sizes, so a large reference would fail at the platform
 *      before any code here ran.
 *   2. It would cost. Every byte through a route handler is billed as Fast
 *      Origin Transfer, and the bytes would be paid for TWICE — in and out.
 *      This project has a standing rule that nothing may consume where it does
 *      not have to.
 *   3. It would hold memory. `Buffer.from(await file.arrayBuffer())` on 200 MB
 *      is 200 MB resident, which is the exact defect just fixed on the worker.
 *
 * So this route moves no bytes at all. It issues a short-lived signed PUT
 * target (`POST`) and later converts the stored object into a signed GET URL
 * for Kling to fetch (`PATCH`). The browser uploads to Supabase directly.
 *
 * ── 🔴 WHAT IS AND IS NOT CHECKED, STATED HONESTLY ─────────────────────────
 *
 * At ticket time the server knows only what the browser DECLARES — its type and
 * size — so that is what is checked, and a liar could still PUT something else.
 * `PATCH` is therefore the real gate: it reads the object that actually landed
 * and refuses on its true size and content type before handing back a URL. A
 * reference that fails there never reaches a quote, so it can never be charged
 * for.
 *
 * The object key keeps the `<ownerId>/…` prefix every ownership check in this
 * bucket is written against, and is a fresh uuid because these tools have no
 * job yet — the member attaches references, sees a price, and only then
 * generates.
 */

/** The two things a reference can be, and the vendor's limits for each. */
const KINDS = {
  image: {
    mimeTypes: KLING_OMNI.images.mimeTypes as readonly string[],
    maxBytes: KLING_OMNI.images.maxBytes,
    refusal: "Use a JPEG or PNG image.",
  },
  video: {
    /*
      The guide names mp4; `video/quicktime` is what an iPhone produces and the
      vendor fetches by URL rather than by extension. Both are offered because
      refusing a phone's own recording would make the slot useless on the device
      most members are holding.
    */
    mimeTypes: ["video/mp4", "video/quicktime"] as readonly string[],
    maxBytes: KLING_OMNI.video.maxBytes,
    refusal: "Use an MP4 or MOV video.",
  },
} as const;

type ReferenceKind = keyof typeof KINDS;

const isKind = (v: unknown): v is ReferenceKind => v === "image" || v === "video";
const bad = (error?: string) => NextResponse.json(aiErrorBody("INVALID_INPUT", error ? { error } : undefined), { status: aiErrorStatus("INVALID_INPUT") });

async function owner(request: Request) {
  const feature = aiFeature("ai_image_to_video");
  if (!feature) return { error: NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") }) };
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return { error: NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") }) };
  const ownerId = subjectOwnerId(subject);
  if (!ownerId) return { error: NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") }) };
  return { ownerId, subjectKey: subject.key };
}

/** The key must be this member's own, and must be one we minted. */
function ownsPath(path: string, ownerId: string): boolean {
  return typeof path === "string" && path.length < 300 && path.startsWith(`${ownerId}/video-reference/`) && !path.includes("..");
}

/** POST — "I am about to upload a reference of this kind." Returns a PUT target. */
export async function POST(request: Request) {
  const who = await owner(request);
  if ("error" in who) return who.error;

  const burst = await aiJobCreateLimiter.limit(`ai-video-ref:${who.subjectKey}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });

  let body: { kind?: unknown; contentType?: unknown; size?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad();
  }
  if (!isKind(body.kind)) return bad();
  const spec = KINDS[body.kind];

  const contentType = typeof body.contentType === "string" ? body.contentType.split(";")[0]!.trim().toLowerCase() : "";
  if (!spec.mimeTypes.includes(contentType)) return bad(spec.refusal);

  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) return bad();
  if (size > spec.maxBytes) return NextResponse.json(aiErrorBody("FILE_TOO_LARGE"), { status: aiErrorStatus("FILE_TOO_LARGE") });

  const ext = contentType === "image/png" ? "png" : contentType === "image/jpeg" ? "jpg" : contentType === "video/quicktime" ? "mov" : "mp4";
  const path = `${who.ownerId}/video-reference/${randomUUID()}.${ext}`;

  const { data, error } = await createAdminClient().storage.from(AI_SOURCE_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data?.signedUrl) {
    console.error("[ai/video/reference] ticket failed", { ownerId: who.ownerId, message: error?.message });
    return NextResponse.json(aiErrorBody("STORAGE_ERROR"), { status: aiErrorStatus("STORAGE_ERROR") });
  }

  return NextResponse.json(
    {
      path,
      uploadUrl: data.signedUrl.startsWith("http") ? data.signedUrl : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${data.signedUrl}`,
    },
    { status: 201 },
  );
}

/**
 * PATCH — "the upload finished." Verifies what actually landed and returns the
 * URL Kling will fetch.
 *
 * 🔴 This is the real gate, not POST. POST believed a declaration; this reads
 * the stored object.
 */
export async function PATCH(request: Request) {
  const who = await owner(request);
  if ("error" in who) return who.error;

  const burst = await aiJobReadLimiter.limit(`ai-video-ref-done:${who.subjectKey}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });

  let body: { kind?: unknown; path?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad();
  }
  if (!isKind(body.kind)) return bad();
  if (typeof body.path !== "string" || !ownsPath(body.path, who.ownerId)) return bad();
  const spec = KINDS[body.kind];

  const stored = await statSourceObject(body.path).catch(() => null);
  if (!stored) return bad("That upload didn't finish. Try attaching it again.");
  if (stored.size <= 0) return bad("That file is empty.");
  if (stored.size > spec.maxBytes) return NextResponse.json(aiErrorBody("FILE_TOO_LARGE"), { status: aiErrorStatus("FILE_TOO_LARGE") });
  /*
    A null mime from the bucket is not treated as a failure: Storage does not
    always record one, and refusing on its absence would reject good uploads.
    A mime that IS recorded and is wrong is refused.
  */
  if (stored.mimeType && !spec.mimeTypes.includes(stored.mimeType.split(";")[0]!.trim().toLowerCase())) return bad(spec.refusal);

  try {
    return NextResponse.json({ url: await signSourceUrl(body.path), path: body.path }, { status: 200 });
  } catch {
    return NextResponse.json(aiErrorBody("STORAGE_ERROR"), { status: aiErrorStatus("STORAGE_ERROR") });
  }
}
