"use client";

/**
 * Natural pixel size of an image File, read entirely in the browser before
 * upload. Prefers `createImageBitmap` (decodes without ever attaching to the
 * DOM); falls back to a plain `<img>` load for browsers/formats that don't
 * support it. Resolves null if the file can't be decoded — callers publish
 * without dimensions rather than blocking the upload on this.
 */
export async function readImageSize(file: File): Promise<{ w: number; h: number } | null> {
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(file);
      const size = { w: bmp.width, h: bmp.height };
      bmp.close?.();
      return size;
    }
  } catch {
    /* fall through */
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}
