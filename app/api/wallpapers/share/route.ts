import { NextResponse } from "next/server";

import { imageSizeOf } from "@/lib/media/image-size";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/wallpapers/share (multipart) — a signed-in member publishes one of
 * their downloaded images to the public wallpaper library (owner: "users who
 * signed in can share their wallpaper image download to public and others can
 * view in wallpaper and like them and comment").
 *
 * The row is created as `source: 'member'` with the member as `uploaded_by`, so
 * the library can attribute it and an operator can hide it from the dashboard
 * like any other. Bytes go to `members/<uid>/…` in the public wallpapers bucket
 * — the same folder shape the storage RLS policy confines members to, so this
 * route grants nothing a member couldn't already do directly.
 */

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const MAX_BYTES = 20 * 1024 * 1024;

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

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose an image." }, { status: 400 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: "JPEG, PNG, WebP or AVIF only." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Images must be under 20 MB." }, { status: 400 });

  const title = ((form.get("title") as string | null) ?? "").trim().slice(0, 120) || "Shared wallpaper";
  const category = ((form.get("category") as string | null) ?? "").trim().slice(0, 40) || "Community";

  const db = createAdminClient();
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const key = `members/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const { error: upErr } = await db.storage.from("wallpapers").upload(key, file, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    const { data: pub } = db.storage.from("wallpapers").getPublicUrl(key);
    // Same measurement as the admin upload — a member's share earns its
    // resolution badge on exactly the same evidence, or shows none.
    const size = await imageSizeOf(file);
    const { data, error } = await db
      .from("wallpapers")
      .insert({
        title,
        category,
        image_url: pub.publicUrl,
        bytes: file.size,
        width: size?.width ?? null,
        height: size?.height ?? null,
        status: "published",
        source: "member",
        uploaded_by: user.id,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      // Never leave an orphaned object behind if the row didn't land.
      await db.storage.from("wallpapers").remove([key]);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: data?.id ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
