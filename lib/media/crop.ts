/**
 * The crop maths behind the avatar / cover cropper.
 *
 * Pure and separate from the component on purpose. This is geometry that looks
 * obviously right and is wrong at the edges — an off-by-half on the centre, a
 * clamp that forgets the image can be smaller than the frame on one axis, a
 * source rect that drifts as you zoom. None of that is visible by looking at a
 * picture in a circle; you only find out when somebody's face is off-centre in
 * a file that has already been uploaded.
 *
 * Every function works in two coordinate spaces and the names say which:
 *   • FRAME space — CSS pixels of the on-screen crop square.
 *   • SOURCE space — natural pixels of the original image.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Offset {
  x: number;
  y: number;
}

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The scale at which the image exactly COVERS the frame — never contains it.
 *
 * `max`, not `min`: a contained image leaves bars, and an avatar with
 * transparent bars baked into the file is a bug that survives every later
 * attempt to style around it.
 */
export function coverScale(image: Size, frame: Size): number {
  if (image.width <= 0 || image.height <= 0) return 1;
  return Math.max(frame.width / image.width, frame.height / image.height);
}

/**
 * Constrain an offset so the frame stays fully covered.
 *
 * The bound is half the overflow on each axis. `Math.max(0, …)` matters: at
 * exactly cover scale the overflow on one axis is zero, and a negative bound
 * would invert the clamp and let the image escape in the one case where it must
 * not move at all.
 */
export function clampOffset(offset: Offset, image: Size, frame: Size, scale: number): Offset {
  const maxX = Math.max(0, (image.width * scale - frame.width) / 2);
  const maxY = Math.max(0, (image.height * scale - frame.height) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

/**
 * The region of the SOURCE image currently under the frame.
 *
 * The frame's centre sits at the image's centre displaced by `offset` (frame
 * pixels), so dividing by the scale converts that displacement into source
 * pixels. The frame's own size divided by the scale is how much source it
 * spans. Sign is negative because moving the image right shows what is further
 * LEFT in the source.
 */
export function sourceRect(image: Size, frame: Size, scale: number, offset: Offset): SourceRect {
  const sw = frame.width / scale;
  const sh = frame.height / scale;
  const cx = image.width / 2 - offset.x / scale;
  const cy = image.height / 2 - offset.y / scale;
  return { sx: cx - sw / 2, sy: cy - sh / 2, sw, sh };
}

/**
 * On-screen size of the crop frame for a ratio, bounded on its LONG edge.
 *
 * Bounding the long edge rather than the width is what keeps a portrait frame
 * inside the dialog. The landing page's phone-mockup slot is 0.72, and
 * `viewport / aspect` would make that frame 367px tall — taller than the dialog
 * can show on a short screen, which puts Cancel/Use photo off the bottom of a
 * modal that has no scroll. Square and landscape ratios are unaffected: for
 * `aspect >= 1` the long edge IS the width, so this returns what it always did.
 */
export function frameSize(aspect: number, viewport: number): Size {
  return aspect >= 1
    ? { width: viewport, height: Math.round(viewport / aspect) }
    : { width: Math.round(viewport * aspect), height: viewport };
}

/** Output pixel size for a frame ratio, capped on the long edge. */
export function outputSize(frame: Size, longEdge: number): Size {
  const ratio = frame.width / frame.height;
  return ratio >= 1
    ? { width: longEdge, height: Math.round(longEdge / ratio) }
    : { width: Math.round(longEdge * ratio), height: longEdge };
}
