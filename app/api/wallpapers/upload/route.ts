import { after, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { wallpaperTitle } from "@/lib/wallpaper-title";
import { commitWallpaperUpload, signWallpaperUploads } from "@/lib/wallpapers-upload";
import { warmWallpaperImage } from "@/lib/wallpapers-warm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILES = 20;

/**
 * A member's wallpaper upload, straight to storage (2026-10-26 — lib/wallpapers-upload.ts says why).
 *
 *   POST { step: "sign", files: [{ type, size }] }        → { uploads: [{ key, token }] }   (one per file, own folder)
 *   POST { step: "commit", key, name?, category?, index, batchSize, filename }  → the row, created from the stored file
 *
 * The browser uploads each file to its signed URL in between. The old multipart /api/wallpapers/share stays for any
 * client still sending one small file.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to share." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const owner = { kind: "member" as const, userId: user.id };

  if (body.step === "sign") {
    const out = await signWallpaperUploads(owner, body.files, MAX_FILES);
    return out.ok ? NextResponse.json({ ok: true, uploads: out.uploads }) : NextResponse.json({ error: out.error }, { status: 400 });
  }
  if (body.step === "commit") {
    const category = (typeof body.category === "string" ? body.category : "").trim().slice(0, 40) || "Community";
    const batchName = (typeof body.name === "string" ? body.name : "").trim().slice(0, 120);
    const index = Math.max(1, Math.min(MAX_FILES, Number(body.index) || 1));
    const batchSize = Math.max(1, Math.min(MAX_FILES, Number(body.batchSize) || 1));
    const filename = (typeof body.filename === "string" ? body.filename : "").slice(0, 200);
    const title = wallpaperTitle({ batchName, batchSize, index, filename, category });
    const out = await commitWallpaperUpload(owner, body.key, { title, category });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 });
    const url = out.url;
    after(() => warmWallpaperImage(url));
    // people who asked to hear about this member's posts hear about the upload — once per batch, on its first file
    if (index === 1 && out.id) {
      const wid = out.id;
      after(() => import("@/lib/social/creator-notify-emit").then((m) => m.notifyNewWallpaper(user.id, wid, batchSize)).catch(() => {}));
    }
    return NextResponse.json({ ok: true, id: out.id, title: out.title });
  }
  return NextResponse.json({ error: "Invalid request." }, { status: 400 });
}

/**
 * DELETE ?id= — a member removes a wallpaper THEY posted (owner, 2026-10-26: "let users be able to delete their
 * Wallpapers they posted"). Only their own (`uploaded_by` + `source: 'member'`, matched in the same statement), and the
 * files in their own folder go with it. Anyone else's: 404, nothing changes.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();
  const { data, error } = await db.from("wallpapers").delete().eq("id", id).eq("uploaded_by", user.id).eq("source", "member").select("image_url, thumb_url");
  if (error) return NextResponse.json({ error: "Couldn't delete that. Try again." }, { status: 500 });
  const row = (data ?? [])[0] as { image_url?: string | null; thumb_url?: string | null } | undefined;
  if (!row) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // only files in this member's own folder are removed (a key outside it is never touched)
  const own = `members/${user.id}/`;
  const keys = [row.image_url, row.thumb_url]
    .map((u) => (u && u.includes("/wallpapers/") ? decodeURIComponent(u.slice(u.lastIndexOf("/wallpapers/") + "/wallpapers/".length)) : null))
    .filter((k): k is string => !!k && k.startsWith(own) && !k.includes(".."));
  if (keys.length) await db.storage.from("wallpapers").remove(keys).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
