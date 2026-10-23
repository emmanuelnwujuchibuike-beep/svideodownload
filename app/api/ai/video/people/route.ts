import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { aiFeature } from "@/lib/ai/jobs";
import { validateReferenceVideoFacts } from "@/lib/ai/kling/features/shared";
import { signSourceViewUrl } from "@/lib/ai/storage-server";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { subjectOwnerId } from "@/lib/ai/subject";
import { dispatchVideoInspect, inspectRefusal } from "@/lib/ai/video/inspect-dispatch";
import { signInspection } from "@/lib/ai/video/inspection-token";
import { aiPreflightLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai/video/people — "who is in my video?" (Character Replace, 2026-10-19)
 *
 * The member's own uploaded reference video is run through the worker's
 * person detector; the answer is the frame to tap on, the people on it, and a
 * signed inspection token the quote and the job trust instead of the browser.
 * Nothing is priced, reserved or sent to Kling here.
 */
const fail = (code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) => NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code), headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request) {
  const feature = aiFeature("ai_person_replace");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");
  const userId = subjectOwnerId(subject);
  if (!userId) return fail("AUTH_REQUIRED");

  // the detector is the worker's heaviest work — a member cannot run it in a loop
  const burst = await aiPreflightLimiter.limit(`ai-video-people:${subject.key}`);
  if (!burst.success) return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });

  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const path = typeof body?.path === "string" ? body.path : "";
  if (!path.startsWith(`${userId}/video-reference/`) || path.includes("..")) return fail("INVALID_INPUT");

  const outcome = await dispatchVideoInspect({ userId, path, detect: true });
  if (!outcome.ok) return fail("INVALID_INPUT", { error: inspectRefusal(outcome.code) });
  const limits = validateReferenceVideoFacts(outcome.facts);
  if (!limits.ok) return fail("INVALID_INPUT", { error: limits.reason });
  if (!outcome.people || !outcome.frame) return fail("INVALID_INPUT", { error: inspectRefusal("UNREADABLE") });

  const signed = signInspection({ kind: "people", userId, path, fingerprint: outcome.fingerprint, facts: outcome.facts, people: outcome.people, frameMs: outcome.frame.positionMs });
  let frameUrl: string | null = null;
  try {
    frameUrl = (await signSourceViewUrl(outcome.frame.path)).url;
  } catch {
    frameUrl = null;
  }
  return NextResponse.json(
    {
      token: signed.token,
      expiresAt: new Date(signed.expiresAt).toISOString(),
      facts: { durationMs: outcome.facts.durationMs, width: outcome.facts.width, height: outcome.facts.height, hasAudio: outcome.hasAudio },
      people: outcome.people,
      frame: { url: frameUrl, positionMs: outcome.frame.positionMs },
      countsVary: !!outcome.countsVary,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
