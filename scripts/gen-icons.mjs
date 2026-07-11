import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BRAND = path.join(ROOT, "public/brand");
const PUB = path.join(ROOT, "public");
const APP = path.join(ROOT, "app");

const DARK = "#050816";

async function makeMaskable() {
  // frenz-logo.png: 512x512 transparent F+play glyph, currently reused
  // (verbatim, no padding) as BOTH the flat "any" icon and the "maskable"
  // one — the actual bug (see PWA audit Part 1). Trim to the glyph's true
  // bounds, scale it down so it comfortably fits Android's ~80%-diameter
  // safe-zone circle, then composite centered on an opaque dark tile. The
  // flat icon-512/192 keep their existing edge-to-edge look, which is
  // correct for purpose:"any".
  const trimmed = await sharp(path.join(BRAND, "frenz-logo.png")).trim().toBuffer();
  const target = Math.round(512 * 0.62); // ~317px — safe well inside the mask
  const glyph = await sharp(trimmed)
    .resize({ width: target, height: target, fit: "inside" })
    .toBuffer();

  await sharp({
    create: { width: 512, height: 512, channels: 4, background: DARK },
  })
    .composite([{ input: glyph, gravity: "center" }])
    .png()
    .toFile(path.join(PUB, "icon-maskable-512.png"));

  console.log("wrote icon-maskable-512.png (safe-zone padded)");
}

async function makeStoreIcon() {
  // 1024 "any" icon for future store/TWA submission — same edge-to-edge
  // treatment as the existing 512/192, just higher resolution.
  const trimmed = await sharp(path.join(BRAND, "frenz-logo.png")).trim().toBuffer();
  const target = Math.round(1024 * 0.94);
  const glyph = await sharp(trimmed)
    .resize({ width: target, height: target, fit: "inside", kernel: "lanczos3" })
    .toBuffer();

  await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: DARK },
  })
    .composite([{ input: glyph, gravity: "center" }])
    .png()
    .toFile(path.join(PUB, "icon-1024.png"));

  console.log("wrote icon-1024.png");
}

async function makeAppleLegacySizes() {
  // Legacy explicit apple-touch-icon sizes — downsampled from the existing,
  // already-correct 180x180 master (opaque, pre-cropped for Apple's rounded
  // square convention). Modern iOS only strictly needs one 180 image and
  // scales it, but these are cheap and match older iPad/iPhone guidance.
  const src = path.join(APP, "apple-icon.png");
  for (const size of [152, 167]) {
    await sharp(src)
      .resize(size, size)
      .png()
      .toFile(path.join(PUB, `apple-icon-${size}.png`));
    console.log(`wrote apple-icon-${size}.png`);
  }
}

async function main() {
  await makeMaskable();
  await makeStoreIcon();
  await makeAppleLegacySizes();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
