import { after, NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { wallpaperTitle } from "@/lib/wallpaper-title";
import { commitWallpaperUpload, signWallpaperUploads } from "@/lib/wallpapers-upload";
import { warmWallpaperImage } from "@/lib/wallpapers-warm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The short edge below which a wallpaper can't look sharp on a phone (1080×1920 and up is the target). */
const LOW_RES_SHORT_EDGE = 1080;
const MAX_FILES = 50;

/**
 * The admin's wallpaper upload, straight to storage (2026-10-26 — lib/wallpapers-upload.ts): the same sign → upload →
 * commit as a member's, into curated/, as `source: 'admin'`. Admin only.
 */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const owner = { kind: "admin" as const, adminId: admin.id };

  if (body.step === "sign") {
    const out = await signWallpaperUploads(owner, body.files, MAX_FILES);
    return out.ok ? NextResponse.json({ ok: true, uploads: out.uploads }) : NextResponse.json({ ok: false, error: out.error }, { status: 400 });
  }
  if (body.step === "commit") {
    const category = (typeof body.category === "string" ? body.category : "").trim() || "Abstract";
    const batchName = (typeof body.name === "string" ? body.name : "").trim().slice(0, 120);
    const index = Math.max(1, Number(body.index) || 1);
    const batchSize = Math.max(1, Number(body.batchSize) || 1);
    const filename = (typeof body.filename === "string" ? body.filename : "").slice(0, 200);
    const title = wallpaperTitle({ batchName, batchSize, index, filename, category });
    const out = await commitWallpaperUpload(owner, body.key, { title, category });
    if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: 400 });
    const url = out.url;
    // 2026-10-09 landing speed test: the newest wallpaper is the landing LCP — warm its optimized variants now
    after(() => warmWallpaperImage(url));
    const lowRes = out.width && out.height && Math.min(out.width, out.height) < LOW_RES_SHORT_EDGE ? `${out.title} (${out.width}×${out.height})` : null;
    return NextResponse.json({ ok: true, id: out.id, title: out.title, lowRes });
  }
  return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
}
