import { NextResponse } from "next/server";

import { memberConcurrency } from "@/lib/ai/character-replace/start-job";
import { countOpenJobs, openCharacterReplaceJob, openGate, resolveLineage, screenCreateFacts, validateCreateFacts, type JobLineage } from "@/lib/ai/character-replace/open-job";
import { createCharacterReplaceJobSchema } from "@/lib/ai/character-replace/start-schema";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { aiErrorBody, aiErrorStatus, isAiJobError, storedErrorMessage } from "@/lib/ai/errors";
import { aiFeature, isValidClientRequestId, jobToView } from "@/lib/ai/jobs";
import { findJobByRequestId } from "@/lib/ai/job-store";
import { supersedeOwnDrafts } from "@/lib/ai/retention";
import { subjectOwnerId } from "@/lib/ai/subject";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { getAdminUser } from "@/lib/admin/require-admin";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobCreateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  POST /api/ai/character-replace/jobs — open a job, mint TWO upload tickets
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Step 7's first half. Nothing is charged here and nothing is sent anywhere:
 * this opens the row (`ai_jobs`, feature `ai_character_replace`) and hands
 * the browser two signed, single-object upload URLs — the video and the
 * character image — into the member's own folder of the private source
 * bucket (§39: browser → storage, never browser → server → provider). The
 * charge, the checks that spend money and the hand-off to the worker all
 * happen at /start, once both files are in place.
 *
 * Idempotent on `clientRequestId`: a retry returns the row it already made,
 * with fresh tickets, so a lost response never opens a second job.
 *
 * The checks live in lib/ai/character-replace/open-job.ts since 2026-09-21,
 * shared with the multi-video batch route; this route's own rule is the
 * ceiling on how many jobs one member may have open (below).
 */
function fail(code: Parameters<typeof aiErrorBody>[0], extra?: Record<string, unknown>) {
  return NextResponse.json(aiErrorBody(code, extra), { status: aiErrorStatus(code) });
}

export async function POST(request: Request) {
  const feature = aiFeature("ai_character_replace");
  if (!feature) return fail("FEATURE_UNAVAILABLE");
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return fail("AUTH_REQUIRED");

  const burst = await aiJobCreateLimiter.limit(`ai-cr-job:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), {
      status: aiErrorStatus("RATE_LIMITED"),
      headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) },
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail("INVALID_INPUT");
  }
  const parsed = createCharacterReplaceJobSchema.safeParse(raw);
  if (!parsed.success) return fail("INVALID_INPUT");
  const { clientRequestId, retryOf, ...facts } = parsed.data;
  // Part 6: which replacement. Absent = Full Character, so every client from Parts 1–5 still creates.
  const mode = parsed.data.mode ?? "full_character";
  if (!isValidClientRequestId(clientRequestId)) return fail("INVALID_INPUT");

  try {
    const [settings, entitlement, adminUser] = await Promise.all([getLandingSettings(), getAiEntitlement(subject, feature), getAdminUser().catch(() => null)]);
    const config = settings.frenzAiCharacterReplace;
    const gate = await openGate({ subject, feature, settings, entitlement, config }, mode);
    if (!gate.ok) return fail(gate.code, gate.extra);
    const ctx = { subject, feature, settings, entitlement, config, publicConfig: gate.publicConfig };

    const invalid = validateCreateFacts(ctx, mode, facts);
    if (invalid) return fail(invalid.code, invalid.extra);
    const blocked = screenCreateFacts(subject.key, facts);
    if (blocked) return fail(blocked.code, blocked.extra);

    const ownerId = subjectOwnerId(subject);
    const existing = await findJobByRequestId(subject, clientRequestId);
    if (existing) {
      const opened = existing.status === "queued" ? await openCharacterReplaceJob(ctx, { clientRequestId, mode, facts, lineage: null, batch: null }) : null;
      return NextResponse.json({ job: jobToView(existing, storedErrorMessage), created: false, uploads: opened && "uploads" in opened ? opened.uploads : null });
    }

    /*
      ── Part 10: A NEW PROJECT SUPERSEDES THE MEMBER'S ABANDONED DRAFTS ────
      A draft whose upload failed, or whose tab was closed, sat `queued` and
      counted as active below — so the member's next Create (a new
      clientRequestId after a reset) was refused as "already being made"
      until the daily sweep. Every other never-started draft of theirs is
      expired here, uploads removed, before the count (lib/ai/retention.ts).
    */
    await supersedeOwnDrafts(ownerId, feature.id);

    /*
      ── §28 → 0166: HOW MANY JOBS ONE MEMBER MAY HAVE OPEN ───────────────────
      Queue ON: the ceiling is the operator's "videos in progress at once"
      (waiting + running; this draft joins the line at /start if the slots
      are busy). Queue OFF: the Part 8 rule, unchanged — one open job per
      concurrency slot, drafts included, refused as "already being made".
    */
    const shared = { settings, entitlement, isAdmin: !!adminUser };
    if (config.processing.queueEnabled) {
      const open = await countOpenJobs(subject, feature, { includeDrafts: false });
      if (open >= config.processing.maxVideosPerBatch) return fail("CR_QUEUE_FULL", { openJobs: open, maxOpenJobs: config.processing.maxVideosPerBatch });
    } else {
      const active = await countOpenJobs(subject, feature, { includeDrafts: true });
      if (active >= memberConcurrency(config, shared)) return fail("JOB_ALREADY_PROCESSING");
    }

    let lineage: JobLineage | null = null;
    if (retryOf) {
      const resolved = await resolveLineage(subject, feature, retryOf);
      if ("ok" in resolved) return fail(resolved.code, resolved.extra);
      lineage = resolved;
    }

    const opened = await openCharacterReplaceJob(ctx, { clientRequestId, mode, facts, lineage, batch: null });
    if ("ok" in opened) return fail(opened.code, opened.extra);

    console.info("[cr/jobs] opened", { jobId: opened.row.id, userId: ownerId, feature: feature.id, mode, references: facts.references?.length ?? 0, audio: !!facts.audio, created: opened.created, audience: entitlement.audience, attempt: lineage?.attempt ?? 1, retryOf: lineage?.retryOf ?? null, batch: lineage?.batch?.id ?? null });
    return NextResponse.json({ job: jobToView(opened.row, storedErrorMessage), created: opened.created, uploads: opened.uploads }, { status: opened.created ? 201 : 200 });
  } catch (e) {
    if (isAiJobError(e)) {
      console.error("[cr/jobs] create failed", { subject: subject.key, code: e.code, detail: e.detail });
      return fail(e.code);
    }
    console.error("[cr/jobs] create threw", { subject: subject.key, error: String(e) });
    return fail("INTERNAL_ERROR");
  }
}
