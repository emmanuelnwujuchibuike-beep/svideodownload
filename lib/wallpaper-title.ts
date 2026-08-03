/**
 * What a wallpaper is CALLED.
 *
 * Owner (2026-08-03): "make the IMG4647 that appear on the wallpaper to be
 * wallpaper text or a name the author or admin write."
 *
 * The old rule was "use the filename". For a curated library that is almost
 * always wrong: phones and cameras name files `IMG_8662.JPG`, `DSC00021.jpg`,
 * `PXL_20240113_101500.jpg`, `Screenshot 2026-08-03 at 10.17.jpg` — so a
 * beautiful wallpaper shipped to visitors captioned "IMG 8662".
 *
 * So the order is now:
 *   1. The name the operator typed. Always wins.
 *   2. The filename — but only if it reads like a NAME a person chose.
 *   3. A clean generated name from the category ("Abstract 04").
 *
 * Rule 3 is the important one: a generated name is honest (it describes the
 * category, claims nothing) and looks deliberate, which a camera filename never
 * does. Nothing here invents a description of the image itself.
 *
 * Pure: no I/O, so the classifier is testable on its own.
 */

/** Filenames that are machine-generated rather than chosen by a person. */
const CAMERA_PATTERNS: RegExp[] = [
  /^img[\s_-]*\d+$/i, // IMG_8662, IMG 8662
  /^dsc[\s_-]*\d+$/i, // DSC00021
  /^dscf?\d+$/i,
  /^pxl[\s_-]*\d+/i, // PXL_20240113_101500
  /^photo[\s_-]*\d+$/i,
  /^image[\s_-]*\d*$/i,
  /^screen[\s_-]?shot.*/i,
  /^screenshot.*/i,
  /^whatsapp[\s_-]?image.*/i,
  /^signal[\s_-]?\d+/i,
  /^untitled[\s_-]*\d*$/i,
  /^download[\s_-]*\(?\d*\)?$/i,
  /^[0-9a-f]{8,}$/i, // hashes / uuids
  /^\d+$/, // 20240113101500
  /^(mmexport|wx_camera|微信)/i,
];

/** Strips the extension and normalises separators to spaces. */
export function filenameToWords(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Would this filename make a caption a person would be happy to see under a
 * wallpaper? A name needs at least one real letter-word and must not match a
 * known camera/screenshot pattern.
 */
export function isMeaningfulFilename(filename: string): boolean {
  const words = filenameToWords(filename);
  if (words.length < 3) return false;
  if (CAMERA_PATTERNS.some((re) => re.test(words))) return false;
  // Must contain a word of 3+ letters — "4647 2" or "a1 b2" is not a name.
  return /[a-z]{3,}/i.test(words);
}

/** Title Case, leaving already-capitalised words (acronyms) alone. */
function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export interface WallpaperTitleInput {
  /** What the operator typed for this upload, if anything. */
  batchName: string;
  batchSize: number;
  /** 1-based position within the batch. */
  index: number;
  filename: string;
  category: string;
}

export function wallpaperTitle({ batchName, batchSize, index, filename, category }: WallpaperTitleInput): string {
  // 1. The operator's own name always wins. Numbered only when it has to be.
  const typed = batchName.trim();
  if (typed) return (batchSize > 1 ? `${typed} ${index}` : typed).slice(0, 120);

  // 2. A filename that reads like a name a person chose.
  if (isMeaningfulFilename(filename)) return titleCase(filenameToWords(filename)).slice(0, 120);

  // 3. A clean, honest fallback — the category and a number.
  const cat = titleCase((category || "Wallpaper").trim());
  return `${cat} ${String(index).padStart(2, "0")}`.slice(0, 120);
}
