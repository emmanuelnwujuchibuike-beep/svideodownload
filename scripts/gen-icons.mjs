import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BRAND = path.join(ROOT, "public/brand");
const PUB = path.join(ROOT, "public");
const APP = path.join(ROOT, "app");
const COMPONENTS = path.join(ROOT, "components");
const SOURCE = path.join(BRAND, "frenz-logo.png"); // 512x512, transparent

// Owner decision (2026-07-11): white app-icon identity, replacing the
// earlier dark-navy tile — every PWA/app-icon asset below shares this
// background so the home-screen icon, splash, and share image all read as
// one consistent mark instead of a dark tile that didn't match the white
// manifest background_color/theme_color it was always paired with.
const WHITE = "#ffffff";

/** Trims the source glyph to its true bounds, then scales it to `scale` of
 * `size` and composites it centered on an opaque `size`x`size` canvas. */
async function composedIcon(size, scale, background = WHITE) {
  const trimmed = await sharp(SOURCE).trim().toBuffer();
  const target = Math.round(size * scale);
  const glyph = await sharp(trimmed)
    .resize({
      width: target,
      height: target,
      fit: "inside",
      kernel: "lanczos3",
    })
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: glyph, gravity: "center" }])
    .png()
    .toBuffer();
}

async function makeFlatIcons() {
  // The "any"-purpose home-screen icons — properly centered/padded now
  // (was edge-to-edge on the old dark tile; a padded mark reads as a real
  // app icon on a white ground the way edge-to-edge only worked on dark).
  for (const size of [192, 512]) {
    await sharp(await composedIcon(size, 0.7)).toFile(
      path.join(PUB, `icon-${size}.png`),
    );
    console.log(`wrote icon-${size}.png (white, centered)`);
  }
}

async function makeMaskable() {
  // Safe-zone padded for Android's adaptive-icon mask (unchanged scale from
  // the original fix — see the PWA audit — only the background changed).
  await sharp(await composedIcon(512, 0.62)).toFile(
    path.join(PUB, "icon-maskable-512.png"),
  );
  console.log("wrote icon-maskable-512.png (white, safe-zone padded)");
}

async function makeStoreIcon() {
  // 1024 "any" icon for future store/TWA submission — same centered
  // treatment as the flat icons, just higher resolution.
  await sharp(await composedIcon(1024, 0.7)).toFile(
    path.join(PUB, "icon-1024.png"),
  );
  console.log("wrote icon-1024.png (white, centered)");
}

async function makeAppleIcon() {
  // apple-touch-icon master — iOS applies its own rounded-square mask, so
  // this can stay a plain opaque square same as the others.
  await sharp(await composedIcon(180, 0.7)).toFile(
    path.join(APP, "apple-icon.png"),
  );
  console.log("wrote app/apple-icon.png (white, centered)");
}

async function makeAppleLegacySizes() {
  // Legacy explicit apple-touch-icon sizes — downsampled from the
  // just-regenerated 180x180 master. Modern iOS only strictly needs one
  // 180 image and scales it, but these are cheap and match older
  // iPad/iPhone guidance.
  const src = path.join(APP, "apple-icon.png");
  for (const size of [152, 167]) {
    await sharp(src)
      .resize(size, size)
      .png()
      .toFile(path.join(PUB, `apple-icon-${size}.png`));
    console.log(`wrote apple-icon-${size}.png`);
  }
}

async function makeOgIconData() {
  // Larger transparent embed for the OG/share image (components/og-image.tsx)
  // — 480px so it stays crisp whether used small (a lockup icon) or large
  // (the logo-only default share card). Written as a hardcoded base64
  // constant, not read from disk at runtime: Vercel serverless functions do
  // not reliably expose public/ to fs reads (it's served by the CDN, not
  // the function's filesystem).
  const trimmed = await sharp(SOURCE).trim().toBuffer();
  const buf = await sharp(trimmed)
    .resize({ width: 480, height: 480, fit: "inside" })
    .png()
    .toBuffer();
  const base64 = buf.toString("base64");
  const out =
    `// Auto-generated from public/brand/frenz-logo.png (480x480, transparent) — see components/og-image.tsx.\n` +
    `// Hardcoded, not read from disk at runtime: Vercel serverless functions do not\n` +
    `// reliably expose the public/ directory to fs reads (it is served by the CDN,\n` +
    `// not the function's filesystem). Regenerate via scripts/gen-icons.mjs.\n` +
    `export const OG_ICON_BASE64 =\n  "${base64}";\n`;
  const fs = await import("node:fs/promises");
  await fs.writeFile(path.join(COMPONENTS, "og-icon-data.ts"), out);
  console.log(
    `wrote components/og-icon-data.ts (${(base64.length / 1024).toFixed(0)}KB base64)`,
  );
}

async function makeOgFontData() {
  // The OG-card wordmark font ("Frenz" text), inlined as a base64 constant for
  // the same reason as makeOgIconData above — Vercel serverless functions
  // can't reliably fetch a local static-asset URL outside edge runtime, and a
  // network fetch to Google Fonts at request time adds an avoidable failure
  // mode. Source file: components/fonts/SpaceGrotesk-Bold.ttf (Google Fonts,
  // OFL license) — replace it and re-run this to pick up a different weight/cut.
  const fs = await import("node:fs/promises");
  const fontPath = path.join(COMPONENTS, "fonts/SpaceGrotesk-Bold.ttf");
  const buf = await fs.readFile(fontPath);
  const base64 = buf.toString("base64");
  const out =
    `// Auto-generated from components/fonts/SpaceGrotesk-Bold.ttf (Google Fonts, OFL) — see components/og-image.tsx.\n` +
    `// Hardcoded, not fetched/read at runtime: Vercel serverless functions do not\n` +
    `// reliably resolve local static-asset URLs via fetch(new URL(..., import.meta.url))\n` +
    `// outside edge runtime, and a network fetch adds an avoidable failure mode (see\n` +
    `// the OG-image crash incident memory). Regenerate via scripts/gen-icons.mjs.\n` +
    `export const OG_WORDMARK_FONT_BASE64 =\n  "${base64}";\n`;
  await fs.writeFile(path.join(COMPONENTS, "og-font-data.ts"), out);
  console.log(
    `wrote components/og-font-data.ts (${(base64.length / 1024).toFixed(0)}KB base64)`,
  );
}

async function main() {
  await makeFlatIcons();
  await makeMaskable();
  await makeStoreIcon();
  await makeAppleIcon();
  await makeAppleLegacySizes();
  await makeOgIconData();
  await makeOgFontData();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
