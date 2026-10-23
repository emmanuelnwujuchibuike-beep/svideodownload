import "server-only";

import type { KlingPersonReplaceInput } from "@/lib/ai/kling/features/person-replace";
import type { KlingReferenceInputs } from "@/lib/ai/kling/features/shared";
import type { KlingRunnableFeature } from "@/lib/ai/kling/pipelines/registry";
import { objectFingerprint } from "@/lib/ai/preflight/token";
import { signSourceUrl, statSourceObject } from "@/lib/ai/storage-server";
import { inspectionRefusal, verifyInspection } from "@/lib/ai/video/inspection-token";
import type { PersonReplaceWireInput } from "@/lib/ai/video/schemas";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FROM WHAT THE BROWSER SENT TO WHAT THE PIPELINE MAY TRUST (2026-10-19)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Runs in /api/ai/video/quote and /api/ai/video/jobs, before the pipeline.
 * A pipeline stays pure (no storage, no clock); this is where the signed
 * inspection token is verified and turned into facts, and where storage paths
 * are checked for their owner and signed.
 *
 *   quote   the token is verified; nothing in storage is touched. Media URLs
 *           are PLACEHOLDERS on a reserved domain — the price never depends on
 *           them, and a quote fired on every settings change must stay cheap.
 *   charge  the token is verified AND the video is re-read: a file replaced at
 *           the same path (the upload ticket is upsert) changes its
 *           fingerprint and is refused. Every photo is stat'd for owner, size
 *           and type, and every URL is minted here — the browser's are never
 *           sent to Kling.
 *
 * One entry point for both routes: Text/Image to Video share a resolver (their
 * reference video), Character Replace has its own, Lip Sync passes through.
 */

export type ResolvedInput = { ok: true; input: unknown; sourceFacts?: Record<string, unknown> } | { ok: false; error: string };
type Ctx = { userId: string; forCharge: boolean };

/** `.invalid` is reserved (RFC 2606) — a placeholder that can never resolve, let alone be fetched. */
const PLACEHOLDER = "https://quote.frenz.invalid/";

const IMAGE_PATH = (userId: string) => new RegExp(`^${userId}/video-reference/[0-9a-fA-F-]{36}\\.(jpg|png)$`);
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

async function resolveReferenceVideo(raw: Record<string, unknown>, ctx: Ctx): Promise<ResolvedInput> {
  const { referenceVideoToken, ...rest } = raw as KlingReferenceInputs & { referenceVideoToken?: string } & Record<string, unknown>;
  if (!rest.referenceVideoUrl) return { ok: true, input: rest };
  const v = verifyInspection(referenceVideoToken, { userId: ctx.userId });
  if (!v.ok) return { ok: false, error: inspectionRefusal(v.reason) };
  const facts = v.claims.facts;
  let url = rest.referenceVideoUrl as string;
  if (ctx.forCharge) {
    const stored = await statSourceObject(v.claims.path).catch(() => null);
    if (!stored || objectFingerprint(stored) !== v.claims.fingerprint) return { ok: false, error: inspectionRefusal("signature") };
    url = await signSourceUrl(v.claims.path);
  }
  return {
    ok: true,
    // the measured length prices an edit; the browser's own figure is replaced
    input: { ...rest, referenceVideoUrl: url, referenceVideoFacts: facts, referenceVideoSeconds: Math.round(facts.durationMs) / 1000 },
    sourceFacts: { referenceVideo: facts },
  };
}

async function resolvePersonReplace(raw: PersonReplaceWireInput, ctx: Ctx): Promise<ResolvedInput> {
  const v = verifyInspection(raw.inspection, { userId: ctx.userId, kind: "people" });
  if (!v.ok) return { ok: false, error: inspectionRefusal(v.reason) };
  const claims = v.claims;
  const pattern = IMAGE_PATH(ctx.userId);
  for (const t of raw.targets) for (const p of t.referencePaths) if (!pattern.test(p)) return { ok: false, error: "A photo couldn't be found. Choose it again." };

  let videoUrl = `${PLACEHOLDER}video`;
  const urls = new Map<string, string>();
  if (ctx.forCharge) {
    const stored = await statSourceObject(claims.path).catch(() => null);
    if (!stored || objectFingerprint(stored) !== claims.fingerprint) return { ok: false, error: "Your video changed since it was checked. Open Replace characters again." };
    const paths = [...new Set(raw.targets.flatMap((t) => t.referencePaths))];
    const stats = await Promise.all(paths.map((p) => statSourceObject(p).catch(() => null)));
    for (const s of stats) {
      if (!s || s.size <= 0) return { ok: false, error: "A photo hasn't finished uploading. Choose it again." };
      if (s.size > IMAGE_MAX_BYTES) return { ok: false, error: "A photo is larger than 10 MB." };
      if (s.mimeType && !/^image\/(jpeg|png)/i.test(s.mimeType)) return { ok: false, error: "Use JPEG or PNG photos." };
    }
    const signed = await Promise.all([signSourceUrl(claims.path), ...paths.map((p) => signSourceUrl(p))]);
    videoUrl = signed[0]!;
    paths.forEach((p, i) => urls.set(p, signed[i + 1]!));
  } else {
    raw.targets.forEach((t, ti) => t.referencePaths.forEach((p, k) => urls.set(p, `${PLACEHOLDER}photo-${ti}-${k}`)));
  }

  const input: KlingPersonReplaceInput = {
    videoUrl,
    video: claims.facts,
    people: claims.people ?? [],
    frameMs: claims.frameMs ?? 0,
    targets: raw.targets.map((t) => ({ personId: t.personId, ...(t.description ? { description: t.description } : {}), referenceImageUrls: t.referencePaths.map((p) => urls.get(p)!) })),
    ...(raw.instructions?.trim() ? { instructions: raw.instructions.trim() } : {}),
    ...(raw.options ? { options: raw.options } : {}),
  };
  return {
    ok: true,
    input,
    // what the member chose, kept on the row for the operator — paths, not signed URLs
    sourceFacts: { video: claims.facts, videoPath: claims.path, peopleFound: claims.people?.length ?? 0, targets: raw.targets, consent: raw.consent },
  };
}

export async function resolveVideoInput(feature: KlingRunnableFeature, raw: unknown, ctx: Ctx): Promise<ResolvedInput> {
  try {
    if (feature === "full_character") return await resolvePersonReplace(raw as PersonReplaceWireInput, ctx);
    if (feature === "text_to_video" || feature === "image_to_video") return await resolveReferenceVideo(raw as Record<string, unknown>, ctx);
    return { ok: true, input: raw };
  } catch (e) {
    console.error("[ai/video/resolve] failed", { feature, error: String(e).slice(0, 200) });
    return { ok: false, error: "We couldn't prepare your files just now. Try again in a moment — nothing has been charged." };
  }
}
