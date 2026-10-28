import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { SHOWCASE_BUCKET } from "@/lib/ai/showcase/slides";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/gift/stickers/artwork — multipart `file`: sticker artwork (Frenz Gift Coin Part 3).
 *
 * Re-encoded on the server with sharp (no SVG, no file stored as uploaded), into the existing public `ai-showcase`
 * bucket under `gift-stickers/` — the admin upload pattern of /api/admin/ai/promo, no new bucket or package:
 *   · `image`      a static 512 px WebP with transparency — the grid tile (design: a static frame in the grid)
 *   · `animation`  for an animated GIF or WebP only: the animated 512 px WebP — the stage, the bubble and the reveal
 * The URLs go on the sticker when the admin saves it (POST /api/admin/gift/stickers). Objects are never deleted here:
 * an old revision of a sticker still points at its own artwork.
 */
const ALLOWED = new Set(["image/png", "image/webp", "image/jpeg", "image/gif"]);
const MAX_BYTES = 8 * 1024 * 1024;
const SIZE = 512;

const bad = (error: string, status = 400) => NextResponse.json({ ok: false, error }, { status });

export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return bad("Forbidden", 403);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("Expected an image upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return bad("No image selected.");
  if (!ALLOWED.has(file.type)) return bad("Use a PNG, WebP, GIF or JPEG image.");
  if (file.size > MAX_BYTES) return bad("That image is over 8 MB.");
  const input = Buffer.from(await file.arrayBuffer());

  let still: Buffer;
  let moving: Buffer | null = null;
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(input, { animated: true }).metadata();
    const fit = { width: SIZE, height: SIZE, fit: "inside" as const, withoutEnlargement: true };
    still = await sharp(input, { pages: 1 }).resize(fit).webp({ quality: 82, alphaQuality: 90 }).toBuffer();
    if ((meta.pages ?? 1) > 1) moving = await sharp(input, { animated: true }).resize(fit).webp({ quality: 78, alphaQuality: 90 }).toBuffer();
  } catch {
    return bad("That image could not be read. Try another file.", 422);
  }

  const db = createAdminClient();
  const stem = `gift-stickers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const put = async (key: string, body: Buffer) => {
    const { error } = await db.storage.from(SHOWCASE_BUCKET).upload(key, body, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
    return error ? null : db.storage.from(SHOWCASE_BUCKET).getPublicUrl(key).data.publicUrl;
  };
  const image = await put(`${stem}.webp`, still);
  if (!image) return bad("Couldn't store the artwork. Try again.", 500);
  const animation = moving ? await put(`${stem}-anim.webp`, moving) : null;
  if (moving && !animation) return bad("Couldn't store the animation. Try again.", 500);
  return NextResponse.json({ ok: true, image, animation });
}
