/**
 * Generates the extension's PNG icons (16/48/128) — a rounded brand-gradient
 * square with a white download arrow — with zero dependencies (Node zlib only).
 * Run: `node extension/icons/generate-icons.mjs`
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePng(size, px) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    px.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const r = 0.22; // corner radius (normalized)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const t = (nx + ny) / 2; // diagonal gradient #2563eb → #22d3ee
      let R = Math.round(0x25 + (0x22 - 0x25) * t);
      let G = Math.round(0x63 + (0xd3 - 0x63) * t);
      let B = Math.round(0xeb + (0xee - 0xeb) * t);
      let a = 255;

      // rounded corners
      let dx = 0;
      let dy = 0;
      if (nx < r) dx = r - nx;
      else if (nx > 1 - r) dx = nx - (1 - r);
      if (ny < r) dy = r - ny;
      else if (ny > 1 - r) dy = ny - (1 - r);
      if (dx > 0 && dy > 0 && Math.hypot(dx, dy) > r) a = 0;

      // white download arrow (stem + head + tray)
      const ax = Math.abs(nx - 0.5);
      const stem = ax < 0.08 && ny >= 0.24 && ny <= 0.54;
      const head = ny >= 0.46 && ny <= 0.72 && ax < 0.22 * ((0.72 - ny) / 0.26);
      const tray = ny >= 0.8 && ny <= 0.88 && ax < 0.28;
      if (stem || head || tray) {
        R = 255;
        G = 255;
        B = 255;
      }

      const i = (y * size + x) * 4;
      px[i] = R;
      px[i + 1] = G;
      px[i + 2] = B;
      px[i + 3] = a;
    }
  }
  return px;
}

for (const size of [16, 48, 128]) {
  writeFileSync(join(DIR, `icon${size}.png`), encodePng(size, render(size)));
  console.log(`wrote icon${size}.png`);
}
