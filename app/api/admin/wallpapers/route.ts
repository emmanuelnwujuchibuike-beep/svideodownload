import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { setCtaWallpaper } from "@/lib/wallpapers-cta";
import { imageSizeOf } from "@/lib/media/image-size";
import { wallpaperTitle } from "@/lib/wallpaper-title";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Wallpapers are full-resolution images; the default body limit is too small.
export const maxDuration = 60;

/**
 * Admin wallpaper management.
 *
 * POST (multipart) — upload one or more images into the public `wallpapers`
 *   bucket and publish a row for each. Multi-file on purpose: an operator
 *   curating a set is uploading ten at a time, not one.
 * PATCH  — retitle, recategorise, reorder, or hide/publish a wallpaper.
 * DELETE — remove a wallpaper and its object.
 *
 * Everything is behind `getAdminUser`. Uploads go through the service role, so
 * they land outside the `members/<uid>/` folder that member shares are confined
 * to, and the storage RLS policies never come into it.
 */

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_BYTES = 20 * 1024 * 1024;

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
    return bad("Expected a file upload.");
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return bad("No images selected.");

  const category = (form.get("category") as string | null)?.trim() || "Abstract";
  // An operator-supplied name for this batch. With one file it IS the name;
  // with several it becomes "Name 1", "Name 2", … so a batch upload still ends
  // up with real names instead of camera filenames.
  const batchName = (form.get("name") as string | null)?.trim().slice(0, 120) || "";
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
    const key = `curated/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

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
      const title = wallpaperTitle({
        batchName,
        batchSize: files.length,
        index,
        filename: file.name,
        category,
      });

      /*
        Measured from the header bytes we are already holding — never asked for,
        never assumed. This is what the "4K · Ultra HD" badge is derived from,
        and a file whose header we can't parse stores nulls and shows no badge
        rather than a flattering guess. Costs a 32-byte read; cannot fail the
        upload.
      */
      const size = await imageSizeOf(file);

      const { error: rowErr } = await db.from("wallpapers").insert({
        title,
        category,
        image_url: pub.publicUrl,
        bytes: file.size,
        width: size?.width ?? null,
        height: size?.height ?? null,
        status: "published",
        source: "admin",
        uploaded_by: admin.id,
      });
      if (rowErr) {
        // Don't leave an orphaned object behind if the row didn't land.
        await db.storage.from("wallpapers").remove([key]);
        failed.push(`${file.name}: ${rowErr.message}`);
        continue;
      }
      created.push(title);
    } catch (e) {
      failed.push(`${file.name}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  return NextResponse.json({ ok: true, created: created.length, failed });
}

export async function PATCH(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return bad("Not authorised.", 403);

  let body: {
    id?: string;
    title?: string;
    category?: string;
    status?: string;
    sortOrder?: number;
    viewsBoost?: number;
    likesBoost?: number;
    savesBoost?: number;
    /** Make this wallpaper the background of the Wallpaper Gallery button. */
    ctaBackground?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return bad("Malformed request.");
  }
  if (!body.id) return bad("Missing wallpaper.");

  /*
    The Wallpaper Gallery button's background (owner, 2026-08-09).

    Handled first and returned early: it writes to `settings`, not to the
    wallpaper row, so it must not fall through to the "nothing to change" guard
    below. Setting it to false clears the selection entirely rather than
    clearing only when THIS wallpaper is the current one — an operator toggling
    it off means "no background", and reading the current value first would be a
    race for no benefit.
  */
  if (typeof body.ctaBackground === "boolean") {
    await setCtaWallpaper(body.ctaBackground ? body.id : null);
    return NextResponse.json({ ok: true });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = body.title.trim().slice(0, 120) || "Wallpaper";
  if (typeof body.category === "string") patch.category = body.category.trim().slice(0, 40) || "Abstract";
  if (body.status === "published" || body.status === "hidden") patch.status = body.status;
  if (typeof body.sortOrder === "number") patch.sort_order = Math.trunc(body.sortOrder);

  // Engagement adjustments (0108). These are SIGNED and land in their own
  // columns — the trigger-maintained real counters are never written here, so
  // an adjustment can always be undone by setting it back to 0, and the real
  // number stays recoverable. Bounded so a typo can't set a nine-digit count.
  const BOOST_LIMIT = 10_000_000;
  const boost = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(-BOOST_LIMIT, Math.min(BOOST_LIMIT, Math.trunc(v)))
      : undefined;
  const adjustments: Record<string, unknown> = {};
  const views = boost(body.viewsBoost);
  const likes = boost(body.likesBoost);
  const saves = boost(body.savesBoost);
  if (views !== undefined) adjustments.views_boost = views;
  if (likes !== undefined) adjustments.likes_boost = likes;
  if (saves !== undefined) adjustments.saves_boost = saves;

  if (Object.keys(patch).length === 0 && Object.keys(adjustments).length === 0) return bad("Nothing to change.");

  const db = createAdminClient();
  if (Object.keys(patch).length > 0) {
    const { error } = await db.from("wallpapers").update(patch).eq("id", body.id);
    if (error) return bad(error.message, 500);
  }
  if (Object.keys(adjustments).length > 0) {
    const { error } = await db.from("wallpapers").update(adjustments).eq("id", body.id);
    // Separated so a missing 0108 can't fail a rename, and reported honestly
    // rather than swallowed — an operator who nudged a count must not be told
    // it saved when the column isn't there.
    if (error) {
      return bad("Engagement adjustments need the latest database update (0108).", 503);
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return bad("Not authorised.", 403);

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return bad("Missing wallpaper.");

  const db = createAdminClient();
  try {
    const { data } = await db.from("wallpapers").select("image_url").eq("id", id).maybeSingle();
    const { error } = await db.from("wallpapers").delete().eq("id", id);
    if (error) return bad(error.message, 500);

    // Best-effort object cleanup: derive the key back out of the public URL.
    const url = data?.image_url as string | undefined;
    const marker = "/wallpapers/";
    if (url?.includes(marker)) {
      const key = decodeURIComponent(url.slice(url.lastIndexOf(marker) + marker.length));
      await db.storage.from("wallpapers").remove([key]);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Failed.", 500);
  }
}
