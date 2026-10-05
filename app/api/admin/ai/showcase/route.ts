import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { SHOWCASE_TAG, readStoredShowcase, writeStoredShowcase } from "@/lib/ai/showcase/server";
import { SHOWCASE_BUCKET, normalizeShowcase } from "@/lib/ai/showcase/slides";
import { makeSizedWebp } from "@/lib/media/thumbnail";
import { recordConfigChange } from "@/lib/platform/config-audit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Frenz AI showcase, from the admin's side (features/admin/ai-showcase-editor.tsx).
 *
 * POST (multipart, one `file`) — resize one image to the two copies the card
 *   uses (~720 px and ~1280 px webp, sharp, the wallpaper route's pattern) and
 *   put them in the public `ai-showcase` bucket. Returns the image record; it
 *   is not on any slide until the admin presses Save.
 * PUT  (JSON `{ slides }`) — validate with the same normaliser the page reads
 *   through, store, and drop the cached page for both doors.
 *
 * Only an admin reaches either (getAdminUser). Visitors never call this route:
 * the slides reach them inside the HTML (lib/ai/showcase/server.ts).
 *
 * ⚠️ The original upload is NOT kept. The card can only ever show the two
 * copies, so storing a 12 MB phone photo beside them would be paying for bytes
 * nothing reads.
 */

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_BYTES = 15 * 1024 * 1024;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return bad("Not authorised.", 403);

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

  const bytes = new Uint8Array(await file.arrayBuffer());
  const [sm, lg] = await Promise.all([
    makeSizedWebp(bytes, { maxWidth: 720, quality: 72 }),
    makeSizedWebp(bytes, { maxWidth: 1280, quality: 70 }),
  ]);
  if (!sm || !lg) return bad("That image could not be read. Try another file.", 422);

  const db = createAdminClient();
  const stem = `slides/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const put = async (suffix: string, buffer: Buffer) => {
    const key = `${stem}-${suffix}.webp`;
    const { error } = await db.storage.from(SHOWCASE_BUCKET).upload(key, buffer, {
      contentType: "image/webp",
      // A new upload is always a new key, so the object can be cached forever.
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw new Error(error.message);
    return { key, url: db.storage.from(SHOWCASE_BUCKET).getPublicUrl(key).data.publicUrl };
  };

  try {
    const small = await put("720", sm.buffer);
    let large: { key: string; url: string };
    try {
      large = await put("1280", lg.buffer);
    } catch (e) {
      await db.storage.from(SHOWCASE_BUCKET).remove([small.key]);
      throw e;
    }
    return NextResponse.json({
      ok: true,
      image: { sm: small.url, lg: large.url, width: lg.width, height: lg.height },
      bytes: { sm: sm.buffer.byteLength, lg: lg.buffer.byteLength },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed.";
    // The bucket arrives with migration 0182; say so rather than a storage error string.
    if (/bucket/i.test(message) && /not found/i.test(message)) {
      return bad("The showcase storage bucket is missing — migration 0182 has not been applied.", 503);
    }
    return bad(message, 500);
  }
}

export async function PUT(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return bad("Not authorised.", 403);

  let body: { slides?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Malformed request.");
  }
  if (!Array.isArray(body.slides)) return bad("Missing slides.");

  const slides = normalizeShowcase(body.slides, process.env.NEXT_PUBLIC_SUPABASE_URL);
  const before = await readStoredShowcase();
  const saved = await writeStoredShowcase(slides);
  if (!saved.ok) return bad(saved.error, 500);

  recordConfigChange({
    actorId: admin.id,
    surface: "ai_showcase",
    targetId: "settings",
    action: "settings.update",
    before,
    after: slides,
  });

  /*
    Objects a replaced or deleted slide no longer points at. Best-effort and
    AFTER the save: a failed delete costs a few kB of storage, never the save.
  */
  const keyOf = (url: string) => {
    const marker = `/${SHOWCASE_BUCKET}/`;
    const at = url.lastIndexOf(marker);
    return at === -1 ? null : decodeURIComponent(url.slice(at + marker.length));
  };
  const kept = new Set(slides.flatMap((s) => (s.image ? [s.image.sm, s.image.lg] : [])));
  const gone = (before ?? [])
    .flatMap((s) => (s.image ? [s.image.sm, s.image.lg] : []))
    .filter((u) => !kept.has(u))
    .map(keyOf)
    .filter((k): k is string => !!k);
  if (gone.length > 0) {
    await createAdminClient().storage.from(SHOWCASE_BUCKET).remove(gone).catch(() => undefined);
  }

  // The event that replaces a clock: both doors and the cached read, now.
  revalidateTag(SHOWCASE_TAG);
  revalidatePath("/ai");
  revalidatePath("/studio/ai");

  return NextResponse.json({ ok: true, slides });
}
