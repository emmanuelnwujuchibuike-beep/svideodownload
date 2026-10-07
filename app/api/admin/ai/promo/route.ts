import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { PROMO_PREFIX, PROMO_VIDEO, normalizePromo, type AiPromo } from "@/lib/ai/promo/config";
import { PROMO_TAG, readStoredPromo, writeStoredPromo } from "@/lib/ai/promo/server";
import { SHOWCASE_BUCKET } from "@/lib/ai/showcase/slides";
import { makeSizedWebp } from "@/lib/media/thumbnail";
import { recordConfigChange } from "@/lib/platform/config-audit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Frenz AI landing promotion, from the admin's side
 * (features/admin/ai-promo-editor.tsx). Brief C §6–§7.
 *
 *   POST multipart `file`              an image (before / after / poster) → one
 *                                      720 px webp in the bucket; returns its URL.
 *   POST JSON {kind:"video", …}        a signed ticket; the browser PUTs the clip
 *                                      straight to storage (never through here —
 *                                      Vercel refuses bodies over 4.5 MB, and the
 *                                      bytes have no business on Vercel anyway).
 *   PUT  {promo}                       saves it, deletes objects it no longer
 *                                      points at, and refreshes the landing.
 *
 * Same bucket, prefix `promo/`, same rules as the welcome showcase — admin only,
 * MP4/WebM ≤ 12 MB, images re-encoded to webp. Nothing is on the landing until Save.
 */

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_BYTES = 15 * 1024 * 1024;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

const stem = () => `${PROMO_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return bad("Not authorised.", 403);
  return NextResponse.json({ ok: true, promo: await readStoredPromo() });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return bad("Not authorised.", 403);
  const db = createAdminClient();

  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    let body: { kind?: unknown; contentType?: unknown; size?: unknown };
    try {
      body = await request.json();
    } catch {
      return bad("Malformed request.");
    }
    if (body.kind !== "video") return bad("Unknown upload.");
    const type = typeof body.contentType === "string" ? body.contentType.split(";")[0]!.trim().toLowerCase() : "";
    if (!(PROMO_VIDEO.mimeTypes as readonly string[]).includes(type)) return bad("Use an MP4 or WebM video.");
    const size = Number(body.size);
    if (!Number.isFinite(size) || size <= 0) return bad("Malformed request.");
    if (size > PROMO_VIDEO.maxBytes) return bad(`That video is over ${Math.round(PROMO_VIDEO.maxBytes / (1024 * 1024))} MB — a promo clip is about 3 seconds.`);
    const key = `${stem()}.${type === "video/webm" ? "webm" : "mp4"}`;
    const { data, error } = await db.storage.from(SHOWCASE_BUCKET).createSignedUploadUrl(key);
    if (error || !data?.signedUrl) return bad(error?.message ?? "Could not start the upload.", 500);
    return NextResponse.json({
      ok: true,
      uploadUrl: data.signedUrl.startsWith("http") ? data.signedUrl : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${data.signedUrl}`,
      url: db.storage.from(SHOWCASE_BUCKET).getPublicUrl(key).data.publicUrl,
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("Expected an image upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return bad("No image selected.");
  if (!ALLOWED.has(file.type)) return bad("Use a JPEG, PNG, WebP or AVIF image.");
  if (file.size > MAX_BYTES) return bad("That image is over 15 MB.");
  // The landing tile is ~190 px wide on a phone; 720 covers a 3x screen with room to spare.
  const webp = await makeSizedWebp(new Uint8Array(await file.arrayBuffer()), { maxWidth: 720, quality: 72 });
  if (!webp) return bad("That image could not be read. Try another file.", 422);
  const key = `${stem()}.webp`;
  const { error } = await db.storage.from(SHOWCASE_BUCKET).upload(key, webp.buffer, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true, url: db.storage.from(SHOWCASE_BUCKET).getPublicUrl(key).data.publicUrl, bytes: webp.buffer.byteLength });
}

export async function PUT(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return bad("Not authorised.", 403);
  let body: { promo?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Malformed request.");
  }
  const promo = normalizePromo(body.promo, process.env.NEXT_PUBLIC_SUPABASE_URL);
  const before = await readStoredPromo();
  const saved = await writeStoredPromo(promo);
  if (!saved.ok) return bad(saved.error, 500);

  recordConfigChange({ actorId: admin.id, surface: "ai_promo", targetId: "settings", action: "settings.update", before, after: promo });

  // Objects the saved promo no longer points at — best-effort, after the save.
  const files = (p: AiPromo | null) => (p ? [p.video?.url, p.video?.poster, p.image?.before, p.image?.after].filter((u): u is string => !!u) : []);
  const kept = new Set(files(promo));
  const marker = `/${SHOWCASE_BUCKET}/`;
  const gone = files(before)
    .filter((u) => !kept.has(u))
    .map((u) => (u.lastIndexOf(marker) === -1 ? null : decodeURIComponent(u.slice(u.lastIndexOf(marker) + marker.length))))
    .filter((k): k is string => !!k && k.startsWith(PROMO_PREFIX));
  if (gone.length > 0) await createAdminClient().storage.from(SHOWCASE_BUCKET).remove(gone).catch(() => undefined);

  // The event that replaces a clock: the cached read and the static landing, now.
  revalidateTag(PROMO_TAG);
  revalidatePath("/");
  return NextResponse.json({ ok: true, promo });
}
