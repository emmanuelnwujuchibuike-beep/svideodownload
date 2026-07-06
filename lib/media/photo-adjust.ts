/**
 * Non-destructive photo adjustments for the Creator Studio.
 *
 * The edit is a small parameter object — the original file is never touched.
 * Preview renders instantly on the GPU (CSS filter + blend overlays); Apply
 * bakes the SAME operations into pixels once, via a single typed-array pass
 * (works everywhere — Safari lacks canvas ctx.filter, so no reliance on it).
 * Long edge is capped at bake time: social-size output, faster uploads, less
 * egress.
 */

export interface PhotoParams {
  /** -0.3 .. 0.3 */
  brightness: number;
  /** -0.3 .. 0.3 */
  contrast: number;
  /** -1 .. 1 (-1 = monochrome) */
  saturation: number;
  /** -0.35 .. 0.35 (cool .. warm) */
  warmth: number;
  /** 0 .. 0.3 — lifted blacks, soft matte look */
  fade: number;
  /** 0 .. 0.5 — darkened edges */
  vignette: number;
  /** 0 | 90 | 180 | 270 */
  rotate: number;
  flipH: boolean;
}

export const NEUTRAL_PARAMS: PhotoParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  fade: 0,
  vignette: 0,
  rotate: 0,
  flipH: false,
};

export interface FilterPreset {
  id: string;
  label: string;
  params: Partial<PhotoParams>;
}

/** The Frenzsave signature filter families — original looks, tuned in-house. */
export const FILTER_PRESETS: FilterPreset[] = [
  { id: "original", label: "Original", params: {} },
  { id: "classic", label: "Classic", params: { contrast: 0.08, saturation: 0.06, warmth: 0.08 } },
  { id: "cinema", label: "Cinema", params: { contrast: 0.18, saturation: -0.08, warmth: -0.1, vignette: 0.25, fade: 0.08 } },
  { id: "portrait", label: "Portrait", params: { brightness: 0.06, warmth: 0.12, saturation: -0.04, fade: 0.05 } },
  { id: "golden", label: "Golden Hour", params: { warmth: 0.3, brightness: 0.04, saturation: 0.1, vignette: 0.12 } },
  { id: "noir", label: "Noir", params: { saturation: -1, contrast: 0.22, vignette: 0.3 } },
  { id: "vintage", label: "Vintage", params: { warmth: 0.2, fade: 0.22, contrast: -0.06, vignette: 0.18 } },
  { id: "minimal", label: "Minimal", params: { saturation: -0.15, brightness: 0.05, contrast: -0.04 } },
  { id: "ocean", label: "Ocean", params: { warmth: -0.22, saturation: 0.08, contrast: 0.06 } },
  { id: "forest", label: "Forest", params: { warmth: -0.06, saturation: 0.16, contrast: 0.08, fade: 0.05 } },
  { id: "urban", label: "Urban", params: { contrast: 0.15, saturation: -0.12, warmth: -0.05, vignette: 0.2 } },
  { id: "pastel", label: "Pastel", params: { saturation: -0.2, brightness: 0.09, fade: 0.18, warmth: 0.05 } },
  { id: "studio", label: "Studio", params: { brightness: 0.05, contrast: 0.1, saturation: 0.04 } },
  { id: "night", label: "Night", params: { brightness: -0.08, contrast: 0.15, warmth: -0.15, vignette: 0.3 } },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Final look = manual sliders + preset scaled by its intensity (0..1),
 * clamped to each parameter's range. Fully reversible — nothing is stacked
 * into pixels until Apply.
 */
export function composeParams(manual: PhotoParams, preset: FilterPreset | null, intensity: number): PhotoParams {
  const p = preset?.params ?? {};
  const t = clamp(intensity, 0, 1);
  return {
    brightness: clamp(manual.brightness + (p.brightness ?? 0) * t, -0.3, 0.3),
    contrast: clamp(manual.contrast + (p.contrast ?? 0) * t, -0.3, 0.3),
    saturation: clamp(manual.saturation + (p.saturation ?? 0) * t, -1, 1),
    warmth: clamp(manual.warmth + (p.warmth ?? 0) * t, -0.35, 0.35),
    fade: clamp(manual.fade + (p.fade ?? 0) * t, 0, 0.3),
    vignette: clamp(manual.vignette + (p.vignette ?? 0) * t, 0, 0.5),
    rotate: manual.rotate,
    flipH: manual.flipH,
  };
}

/** Live-preview styles: GPU CSS filter + overlay opacities (no canvas work). */
export function previewStyles(p: PhotoParams): {
  filter: string;
  transform: string;
  warmOpacity: number;
  coolOpacity: number;
  fadeOpacity: number;
  vignetteOpacity: number;
} {
  return {
    filter: [
      `brightness(${1 + p.brightness})`,
      `contrast(${(1 + p.contrast) * (1 - p.fade * 0.25)})`,
      `saturate(${1 + p.saturation})`,
    ].join(" "),
    transform: `rotate(${p.rotate}deg) scaleX(${p.flipH ? -1 : 1})`,
    warmOpacity: Math.max(0, p.warmth) * 0.9,
    coolOpacity: Math.max(0, -p.warmth) * 0.9,
    fadeOpacity: p.fade * 0.45,
    vignetteOpacity: p.vignette * 1.6,
  };
}

const MAX_EDGE = 2560;

/**
 * Bake the parameters into a JPEG blob. One pixel pass (typed array), then
 * the rotate/flip transform — deterministic on every browser.
 */
export async function bakePhoto(source: Blob, p: PhotoParams, quality = 0.92): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const needsPixels =
    p.brightness !== 0 || p.contrast !== 0 || p.saturation !== 0 || p.warmth !== 0 || p.fade !== 0 || p.vignette !== 0;

  if (needsPixels) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const bright = 1 + p.brightness;
    const contr = 1 + p.contrast;
    const sat = 1 + p.saturation;
    const warm = p.warmth * 40;
    const fade = p.fade;
    const vig = p.vignette;
    const cx = w / 2;
    const cy = h / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);

    for (let y = 0; y < h; y++) {
      // Per-row vignette base keeps the inner loop lean.
      const dy = y - cy;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        let r = d[i]!;
        let g = d[i + 1]!;
        let b = d[i + 2]!;

        // contrast
        r = (r - 128) * contr + 128;
        g = (g - 128) * contr + 128;
        b = (b - 128) * contr + 128;
        // saturation (luma-preserving)
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        r = luma + (r - luma) * sat;
        g = luma + (g - luma) * sat;
        b = luma + (b - luma) * sat;
        // warmth
        r += warm;
        b -= warm;
        // brightness
        r *= bright;
        g *= bright;
        b *= bright;
        // fade — lift blacks toward a soft matte gray
        if (fade > 0) {
          r = r * (1 - fade * 0.4) + fade * 60;
          g = g * (1 - fade * 0.4) + fade * 60;
          b = b * (1 - fade * 0.4) + fade * 60;
        }
        // vignette
        if (vig > 0) {
          const dx = x - cx;
          const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
          const m = 1 - vig * dist * dist * 1.3;
          r *= m;
          g *= m;
          b *= m;
        }

        d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // Rotate / flip onto the output canvas.
  const rotated = p.rotate === 90 || p.rotate === 270;
  const out = document.createElement("canvas");
  out.width = rotated ? h : w;
  out.height = rotated ? w : h;
  const octx = out.getContext("2d");
  if (!octx) throw new Error("Canvas unavailable");
  octx.translate(out.width / 2, out.height / 2);
  octx.rotate((p.rotate * Math.PI) / 180);
  octx.scale(p.flipH ? -1 : 1, 1);
  octx.drawImage(work, -w / 2, -h / 2);

  return new Promise<Blob>((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Export failed"))), "image/jpeg", quality);
  });
}
