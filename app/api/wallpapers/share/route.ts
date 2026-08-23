import { NextResponse } from "next/server";

import { imageSizeOf } from "@/lib/media/image-size";
import { makeThumbnail } from "@/lib/media/thumbnail";
import { wallpaperTitle } from "@/lib/wallpaper-title";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/wallpapers/share (multipart) — a signed-in member publishes one or
 * more of their own images to the public wallpaper library (owner: "users who
 * signed in can share their wallpaper image download to public and others can
 * view in wallpaper and like them and comment"; extended 2026-08-23 for the
 * /wallpapers page's own upload button, which lets a member pick several files
 * at once instead of one at a time).
 *
 * Multi-file on purpose, capped at `MAX_FILES` — a member picking a whole photo
 * roll should land as several real rows, not a client-side loop of single
 * requests, but nothing here goes through moderation before publishing (see
 * migration 0105's RLS policy), so an unbounded batch from one request is an
 * unbounded batch of instantly-public rows.
 *
 * Each row is created as `source: 'member'` with the member as `uploaded_by`,
 * so the library can attribute it and an operator can hide it from the
 * dashboard like any other. Bytes go to `members/<uid>/…` in the public
 * wallpapers bucket — the same folder shape the storage RLS policy confines
 * members to, so this route grants nothing a member couldn't already do
 * directly.
 */

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to share." }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected an image." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return NextResponse.json({ error: "Choose at least one image." }, { status: 400 });
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Choose up to ${MAX_FILES} images at a time.` }, { status: 400 });
  }

  const category = ((form.get("category") as string | null) ?? "").trim().slice(0, 40) || "Community";
  // An optional name for the whole batch — mirrors the admin uploader's
  // behaviour (lib/wallpaper-title.ts) so a member naming their set gets
  // "Name 1", "Name 2", … instead of every row falling back to the filename.
  const batchName = ((form.get("name") as string | null) ?? "").trim().slice(0, 120);

  const db = createAdminClient();
  const created: string[] = [];
  const failed: string[] = [];
  let index = 0;

  for (const file of files) {
    if (!ALLOWED.has(file.type)) {
      failed.push(`${file.name}: unsupported type`);
      continue;
    }
    if (file.size > MAX_BYTES) {
      failed.push(`${file.name}: over 20 MB`);
      continue;
    }

    const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const key = `members/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    try {
      const { error: upErr } = await db.storage.from("wallpapers").upload(key, file, {
        contentType: file.type,
        cacheControl: "31536000",
        upsert: false,
      });
      if (upErr) {
        failed.push(`${file.name}: ${upErr.message}`);
        continue;
      }

      const { data: pub } = db.storage.from("wallpapers").getPublicUrl(key);
      index += 1;
      const title = wallpaperTitle({ batchName, batchSize: files.length, index, filename: file.name, category });
      // Same measurement the admin upload uses — a member's share earns its
      // resolution badge on exactly the same evidence, or shows none.
      const size = await imageSizeOf(file);

      // A real small copy for the grid, deck and reels-viewer thumbnail (see
      // lib/media/thumbnail.ts). Best-effort: a failure here just leaves
      // `thumb_url` null, and `toWallpaper` already falls back to the full image.
      let thumbUrl: string | null = null;
      const thumb = await makeThumbnail(new Uint8Array(await file.arrayBuffer()));
      if (thumb) {
        const thumbKey = `members/${user.id}/thumbs/${key.slice(key.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "")}.${thumb.ext}`;
        const { error: thumbErr } = await db.storage.from("wallpapers").upload(thumbKey, thumb.buffer, {
          contentType: thumb.contentType,
          cacheControl: "31536000",
          upsert: false,
        });
        if (!thumbErr) {
          thumbUrl = db.storage.from("wallpapers").getPublicUrl(thumbKey).data.publicUrl;
        }
      }

      const { error: rowErr } = await db
        .from("wallpapers")
        .insert({
          title,
          category,
          image_url: pub.publicUrl,
          thumb_url: thumbUrl,
          bytes: file.size,
          width: size?.width ?? null,
          height: size?.height ?? null,
          status: "published",
          source: "member",
          uploaded_by: user.id,
        });

      if (rowErr) {
        // Never leave an orphaned object behind if the row didn't land.
        await db.storage.from("wallpapers").remove([key]);
        failed.push(`${file.name}: ${rowErr.message}`);
        continue;
      }
      created.push(title);
    } catch (e) {
      failed.push(`${file.name}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  return NextResponse.json({ ok: created.length > 0, created: created.length, failed });
}
