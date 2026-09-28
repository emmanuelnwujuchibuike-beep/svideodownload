import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { KLING_OMNI } from "@/lib/ai/kling/features/capabilities";
import { AI_SOURCE_BUCKET } from "@/lib/ai/storage";
import { signSourceUrl } from "@/lib/ai/storage-server";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { subjectOwnerId } from "@/lib/ai/subject";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiJobCreateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai/video/upload — a member's image, made fetchable by Kling.
 *
 * Kling fetches an input by URL (proven: an unreachable one fails the task), so
 * an image has to live somewhere it can reach. It goes into the SAME private
 * bucket every other AI input uses, under the owner's id, and comes back as a
 * short-lived signed link — never a public object.
 *
 * ── 🔴 WHY NOT AN UPLOAD TICKET ───────────────────────────────────────────
 *
 * `createSourceUploadTicket` keys the object by JOB id, and these tools have no
 * job yet: the member picks a photo, sees a price, and only then generates. So
 * the object is keyed by a fresh uuid under the owner instead, which keeps the
 * `<userId>/…` prefix the bucket's ownership checks are written against.
 *
 * ── 🔴 NO RE-ENCODING (Part 5 §19, Part 6 §36) ────────────────────────────
 *
 * The bytes are stored exactly as the member sent them. Kling documents jpg and
 * png and fetches the file itself; re-compressing here would cost quality for
 * no technical reason, which both briefs forbid. Validation REFUSES instead.
 */
export async function POST(request: Request) {
  const feature = aiFeature("ai_image_to_video");
  if (!feature) return NextResponse.json(aiErrorBody("FEATURE_UNAVAILABLE"), { status: aiErrorStatus("FEATURE_UNAVAILABLE") });

  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const ownerId = subjectOwnerId(subject);
  if (!ownerId) return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });

  const burst = await aiJobCreateLimiter.limit(`ai-video-upload:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });

  // The vendor's own limits, from the verified table — refused here, never re-encoded.
  const allowed = KLING_OMNI.images.mimeTypes as readonly string[];
  if (!allowed.includes(file.type)) return NextResponse.json(aiErrorBody("INVALID_INPUT", { error: "Use a JPEG or PNG image." }), { status: aiErrorStatus("INVALID_INPUT") });
  if (file.size > KLING_OMNI.images.maxBytes) return NextResponse.json(aiErrorBody("FILE_TOO_LARGE"), { status: aiErrorStatus("FILE_TOO_LARGE") });
  if (file.size <= 0) return NextResponse.json(aiErrorBody("INVALID_INPUT"), { status: aiErrorStatus("INVALID_INPUT") });

  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = `${ownerId}/video-input/${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const { error } = await createAdminClient().storage.from(AI_SOURCE_BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[ai/video/upload] store failed", { ownerId, message: error.message });
    return NextResponse.json(aiErrorBody("STORAGE_ERROR"), { status: aiErrorStatus("STORAGE_ERROR") });
  }

  try {
    return NextResponse.json({ url: await signSourceUrl(path), path }, { status: 201 });
  } catch {
    return NextResponse.json(aiErrorBody("STORAGE_ERROR"), { status: aiErrorStatus("STORAGE_ERROR") });
  }
}
