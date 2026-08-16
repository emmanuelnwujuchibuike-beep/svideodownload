/**
 * Generate a resized WebP thumbnail for wallpapers uploaded before the upload
 * route started making one (app/api/admin/wallpapers/route.ts).
 *
 * WHY: `wallpapers.thumb_url` has existed since migration 0105 and nothing
 * ever wrote it, so `toWallpaper()` (lib/wallpapers-server.ts) falls back to
 * the full-resolution `image_url` for every card in the grid, the fanned deck
 * and the reels viewer — a ~150px tile downloading the same multi-megapixel
 * file a full-screen open does. The upload route now generates a real one on
 * the way in; this backfills everything published before that shipped.
 *
 * HOW: downloads each full image (there is no cheap partial read for this —
 * unlike the dimension backfill, an actual resize needs the whole file),
 * resizes it with sharp the same way lib/media/thumbnail.ts does, uploads the
 * result to `curated/thumbs/<key>.webp` in the same public bucket, and writes
 * the URL back. Safe to re-run: it only looks at rows where thumb_url IS NULL.
 *
 * Usage:
 *   node scripts/backfill-wallpaper-thumbnails.mjs --dry
 *   node scripts/backfill-wallpaper-thumbnails.mjs
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const DRY = process.argv.includes("--dry");

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  if (!line.includes("=") || line.trim().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const THUMB_MAX_EDGE = 640;
const THUMB_QUALITY = 68;

async function main() {
  const { data, error } = await db
    .from("wallpapers")
    .select("id, title, image_url")
    .is("thumb_url", null)
    .order("created_at", { ascending: true })
    .limit(1000);

  if (error) {
    console.error("Could not read wallpapers:", error.message);
    process.exit(1);
  }
  const rows = data ?? [];
  console.log(`${rows.length} wallpaper(s) with no thumbnail${DRY ? " (dry run)" : ""}\n`);

  let done = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const res = await fetch(row.image_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());

      const buffer = await sharp(Buffer.from(bytes))
        .rotate()
        .resize({ width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: "inside", withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer();

      if (!DRY) {
        const marker = "/wallpapers/";
        const idx = row.image_url.indexOf(marker);
        const originalKey = idx >= 0 ? decodeURIComponent(row.image_url.slice(idx + marker.length)) : row.id;
        const thumbKey = `curated/thumbs/${originalKey.replace(/^curated\//, "").replace(/\.[^.]+$/, "")}.webp`;

        const { error: upErr } = await db.storage.from("wallpapers").upload(thumbKey, buffer, {
          contentType: "image/webp",
          cacheControl: "31536000",
          upsert: true,
        });
        if (upErr) throw new Error(upErr.message);

        const { data: pub } = db.storage.from("wallpapers").getPublicUrl(thumbKey);
        const { error: rowErr } = await db.from("wallpapers").update({ thumb_url: pub.publicUrl }).eq("id", row.id);
        if (rowErr) throw new Error(rowErr.message);
      }

      console.log(`  ok ${row.title} — ${(buffer.length / 1024).toFixed(0)} kB thumb`);
      done += 1;
    } catch (e) {
      console.log(`  !  ${row.title} — ${e.message}`);
      skipped += 1;
    }
  }

  console.log(`\n${DRY ? "Would generate" : "Generated"} ${done}; left alone ${skipped}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
