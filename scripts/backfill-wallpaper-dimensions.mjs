/**
 * Measure and store `width`/`height` for wallpapers uploaded before we started
 * measuring them.
 *
 * WHY: the wallpaper reference design badges every card "4K · Ultra HD". That
 * badge is derived from the real pixel dimensions on the row (`resolutionBadge`
 * in lib/wallpapers.ts) — a wallpaper with no recorded size gets no badge, on
 * purpose, because the alternative is stamping "4K" on things that aren't.
 *
 * The `width`/`height` columns have existed since migration 0105 and NOTHING
 * ever wrote them. The upload routes now measure on the way in, but a column
 * plus new code fixes nothing for rows that already exist — without this pass,
 * the entire existing library would show no badge at all and the feature would
 * look broken rather than honest.
 *
 * HOW: a RANGE request for the first 256 kB of each image, parsed with the same
 * header reader the upload routes use. No decode, no image library, and it
 * downloads ~0.2% of a 20 MB wallpaper — the whole library costs a few MB of
 * egress rather than a few GB.
 *
 * Safe to re-run: it only looks at rows where width IS NULL, so a second run
 * after a failed first one picks up exactly what's left. A file whose header
 * can't be parsed is reported and left null — it will simply keep showing no
 * badge, which is the correct outcome.
 *
 * Usage:
 *   node scripts/backfill-wallpaper-dimensions.mjs --dry
 *   node scripts/backfill-wallpaper-dimensions.mjs
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

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

/*
  The parser is duplicated here rather than imported because this is a plain
  .mjs script and lib/media/image-size.ts is TypeScript behind the `@/` alias —
  the other backfill scripts have the same shape. It is a direct transcription;
  lib/media/image-size.test.ts is what proves the arithmetic.
*/
const MAX_DIMENSION = 100_000;
const ok = (w, h) =>
  Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= MAX_DIMENSION && h <= MAX_DIMENSION
    ? { width: w, height: h }
    : null;
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const ascii = (b, i, n) => {
  let s = "";
  for (let k = 0; k < n; k += 1) s += String.fromCharCode(b[i + k] ?? 0);
  return s;
};

function imageSize(b) {
  if (!b || b.length < 16) return null;

  // PNG
  if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") {
    return ok(u32be(b, 16), u32be(b, 20));
  }

  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
        i += 2;
        continue;
      }
      const len = u16be(b, i + 2);
      if (len < 2) break;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return i + 9 <= b.length ? ok(u16be(b, i + 7), u16be(b, i + 5)) : null;
      if (marker === 0xda) break;
      i += 2 + len;
    }
    return null;
  }

  // WebP
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP" && b.length >= 30) {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") {
      return ok((b[24] | (b[25] << 8) | (b[26] << 16)) + 1, (b[27] | (b[28] << 8) | (b[29] << 16)) + 1);
    }
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return ok((b[26] | (b[27] << 8)) & 0x3fff, (b[28] | (b[29] << 8)) & 0x3fff);
    }
    return null;
  }

  // AVIF / HEIF — find the first `ispe`.
  if (ascii(b, 4, 4) === "ftyp") {
    const limit = Math.min(b.length - 12, 4096);
    for (let i = 8; i < limit; i += 1) {
      if (ascii(b, i, 4) === "ispe") return ok(u32be(b, i + 8), u32be(b, i + 12));
    }
  }
  return null;
}

async function headBytes(url) {
  // Range first — most CDNs honour it and we only need the front of the file.
  // A host that ignores it sends the whole image, which still works; it just
  // costs more, so it is worth asking.
  const res = await fetch(url, { headers: { Range: "bytes=0-262143" } });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function main() {
  const { data, error } = await db
    .from("wallpapers")
    .select("id, title, image_url")
    .is("width", null)
    .order("created_at", { ascending: true })
    .limit(1000);

  if (error) {
    console.error("Could not read wallpapers:", error.message);
    process.exit(1);
  }
  const rows = data ?? [];
  console.log(`${rows.length} wallpaper(s) with no recorded size${DRY ? " (dry run)" : ""}\n`);

  let done = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const size = imageSize(await headBytes(row.image_url));
      if (!size) {
        console.log(`  ?  ${row.title} — header not recognised, leaving null`);
        skipped += 1;
        continue;
      }
      if (!DRY) {
        const { error: upErr } = await db
          .from("wallpapers")
          .update({ width: size.width, height: size.height })
          .eq("id", row.id);
        if (upErr) throw new Error(upErr.message);
      }
      console.log(`  ok ${row.title} — ${size.width}×${size.height}`);
      done += 1;
    } catch (e) {
      console.log(`  !  ${row.title} — ${e.message}`);
      skipped += 1;
    }
  }

  console.log(`\n${DRY ? "Would update" : "Updated"} ${done}; left alone ${skipped}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
