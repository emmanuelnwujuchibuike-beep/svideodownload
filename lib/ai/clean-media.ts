/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI CLEAN — what the interface will accept, decided in one pure place
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Frenz AI Part 1 is the INTERFACE. Nothing here uploads, fetches, decodes or
 * processes anything: these are the rules the picker and the link field apply
 * before a file or a URL is ever shown as chosen, plus the copy for every state
 * the surface can end up in.
 *
 * ── Why it is a module and not four `if`s in a component ──────────────────────
 *
 * The same question ("can AI Clean take this?") is asked by the drop zone, the
 * file picker, the "Change video" action and — when Part 2 lands — the server.
 * Four copies drift, and the way they drift is that the UI accepts a file the
 * backend then refuses, which is the shape of bug this project keeps writing
 * registries to avoid (see `lib/ai/tools.ts`). Pure functions, no DOM, so the
 * test suite can hold them.
 *
 * ── The size ceiling is borrowed, not invented ────────────────────────────────
 *
 * 100 MB is exactly `MAX_BYTES` in `features/create/composer-core.ts`, the limit
 * every existing upload path in this app already enforces. A number picked for
 * AI Clean alone would be a guess about a pipeline that does not exist yet; when
 * the processing backend lands and has a real opinion, this is the one line that
 * moves and the whole surface follows it.
 */

/** The largest file the picker will take. Mirrors the app's existing upload ceiling. */
export const AI_CLEAN_MAX_BYTES = 100 * 1024 * 1024;

export interface AICleanFormat {
  /** Shown to a person, in the supported-formats line. */
  label: string;
  /** Lower-case, no dot. */
  extension: string;
  /**
   * Every MIME string a browser is known to report for this container.
   *
   * AVI is why this is a list: Chrome says `video/x-msvideo`, older Safari says
   * `video/avi`, and some Android pickers hand over an empty string for a file
   * they cannot type at all — which is why the extension is checked too.
   */
  mimeTypes: readonly string[];
}

export const AI_CLEAN_FORMATS: readonly AICleanFormat[] = [
  { label: "MP4", extension: "mp4", mimeTypes: ["video/mp4"] },
  { label: "MOV", extension: "mov", mimeTypes: ["video/quicktime"] },
  { label: "WebM", extension: "webm", mimeTypes: ["video/webm"] },
  { label: "AVI", extension: "avi", mimeTypes: ["video/x-msvideo", "video/avi", "video/msvideo"] },
];

/**
 * The `accept` attribute for the file input.
 *
 * Both halves are needed. The MIME types are what a desktop file dialog filters
 * on, the extensions are what saves an Android picker that reports no type at
 * all, and `video/*` keeps the iOS sheet offering the photo library rather than
 * a file browser that cannot see it.
 */
export const AI_CLEAN_ACCEPT = [
  "video/*",
  ...AI_CLEAN_FORMATS.flatMap((f) => f.mimeTypes),
  ...AI_CLEAN_FORMATS.map((f) => `.${f.extension}`),
].join(",");

/** The supported-formats line, e.g. "MP4 · MOV · WebM · AVI". */
export const AI_CLEAN_FORMAT_LINE = AI_CLEAN_FORMATS.map((f) => f.label).join(" · ");

/**
 * Every way this surface can fail.
 *
 * The first four are reachable today, in the browser, with no backend. The last
 * two are NOT — nothing uploads and nothing processes in Part 1 — and they are
 * declared anyway so the states exist, are styled, and are one `setError` away
 * when the pipeline lands. Declaring them is not claiming them: nothing renders
 * them yet, and the tests below pin which are which.
 */
export type AICleanErrorCode =
  | "unsupported-file"
  | "file-too-large"
  | "invalid-video"
  | "invalid-url"
  | "upload-failed"
  | "processing-failed";

export interface AICleanErrorCopy {
  title: string;
  /** One sentence. Says what happened and what to do — never a code. */
  body: string;
  /** The label on the recovery button. There is always exactly one way out. */
  action: string;
}

export const AI_CLEAN_ERRORS: Record<AICleanErrorCode, AICleanErrorCopy> = {
  "unsupported-file": {
    title: "That file won't work",
    body: `AI Clean takes video files — ${AI_CLEAN_FORMAT_LINE}.`,
    action: "Choose another video",
  },
  "file-too-large": {
    title: "That video is too large",
    body: `Videos need to be under ${Math.round(AI_CLEAN_MAX_BYTES / (1024 * 1024))} MB for now. A shorter clip or a smaller export will work.`,
    action: "Choose another video",
  },
  "invalid-video": {
    title: "We couldn't read that video",
    body: "The file looks like a video but your device couldn't open it. It may be damaged or only partly downloaded.",
    action: "Choose another video",
  },
  "invalid-url": {
    title: "That link doesn't look right",
    body: "Paste a full web address, starting with https://",
    action: "Try another link",
  },
  "upload-failed": {
    title: "Something went wrong",
    body: "We couldn't use this video. Try another file.",
    action: "Choose another video",
  },
  "processing-failed": {
    title: "Something went wrong",
    body: "The cleanup didn't finish. Nothing was changed — you can try again.",
    action: "Choose another video",
  },
};

/** The lower-case extension of a filename, without the dot. "" when it has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export type AICleanFileVerdict = { ok: true } | { ok: false; code: AICleanErrorCode };

/**
 * Whether the picker may accept this file.
 *
 * Takes the three fields it needs rather than a `File`, so the rule is testable
 * in the project's node test environment (no jsdom — see vitest.config.ts) and
 * so a future server-side check can call it with the same shape.
 *
 * A file passes on EITHER its reported MIME type or its extension. Neither
 * signal is reliable alone: pickers hand over empty types for files they cannot
 * classify, and a renamed `.mp4` says nothing about its contents. Both being
 * wrong at once is a real video that reads as unsupported — which the person
 * recovers from in one tap — while the honest failure for a mislabelled file
 * lands later on `invalid-video`, when the browser has actually tried to open it.
 */
export function inspectVideoFile(file: { name: string; size: number; type: string }): AICleanFileVerdict {
  const type = file.type.toLowerCase();
  const ext = fileExtension(file.name);
  const known = AI_CLEAN_FORMATS.some((f) => f.mimeTypes.includes(type) || f.extension === ext);
  if (!known) return { ok: false, code: "unsupported-file" };
  // Size last: "too large" is only useful once we know it is a video at all.
  if (file.size > AI_CLEAN_MAX_BYTES) return { ok: false, code: "file-too-large" };
  if (file.size === 0) return { ok: false, code: "invalid-video" };
  return { ok: true };
}

/**
 * A pasted link, normalised — or null if it is not a web address.
 *
 * 🔴 This PARSES. It does not fetch, probe, HEAD, or resolve anything, in Part 1
 * or ever from the browser: the owner's brief is explicit ("Do not fetch
 * arbitrary URLs from the browser"), and a client-side request to a link someone
 * pasted is a request made from their IP, with their cookies, to a host nobody
 * checked. Whether a link is a SUPPORTED SOURCE is a question only the server
 * can answer, and it is a later part's job.
 *
 * A bare `example.com/clip` is upgraded to `https://` rather than rejected —
 * that is how links arrive from a share sheet, and refusing them would read as
 * a bug. Anything without a dot in its host is refused, so a stray word does not
 * become `https://word`.
 */
export function parseVideoUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  /*
    A bare path is not a link, and prefixing one produces nonsense: the URL
    parser collapses the extra slashes in `https:///clip.mp4` and hands back
    `https://clip.mp4/` — a host invented out of a filename, which then passes
    every check below. Caught by the test, not by reading.
  */
  if (/^[/\\]/.test(trimmed)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // A host with no dot is a hostname on a local network at best, and far more
  // often a word someone typed by accident.
  if (!url.hostname.includes(".") || url.hostname.endsWith(".")) return null;
  return url.toString();
}

/**
 * "1920 × 1080", or null when the dimensions were never measured.
 *
 * Null rather than "0 × 0", and the preview renders it as an em-dash: this
 * codebase's standing rule is that an absent measurement never renders as a
 * zero, because "not measured" and "measured as nothing" are different claims.
 */
export function formatResolution(width: number | null, height: number | null): string | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  return `${Math.round(width)} × ${Math.round(height)}`;
}

/**
 * The file extension a stored source should carry.
 *
 * Filename first, because it is what the person's own device called the file
 * and it is right far more often than a MIME type a picker guessed. The MIME
 * type is the fallback, and `mp4` is the last resort — an object with no
 * extension at all is one a media player refuses to open later.
 *
 * Only ever used to build a SERVER-CHOSEN path, and sanitised again there: this
 * decides the suffix, it does not decide where anything is written.
 */
export function extensionForUpload(name: string | undefined, mimeType: string): string {
  const fromName = name ? fileExtension(name) : "";
  if (AI_CLEAN_FORMATS.some((f) => f.extension === fromName)) return fromName;

  const mime = mimeType.trim().toLowerCase();
  const byMime = AI_CLEAN_FORMATS.find((f) => f.mimeTypes.includes(mime));
  if (byMime) return byMime.extension;

  return "mp4";
}

/**
 * What the file is called when it lands in somebody's Downloads folder.
 *
 * 🔴 Sanitised, not trusted. The name came off the member's own device and
 * travelled through a database, so it is treated as text from outside: path
 * separators, dots that could hide an extension, control characters and
 * anything non-printable are stripped, and the length is bounded.
 *
 * 🔴 p{M} — COMBINING MARKS — is in the allow-list, and a test caught its
 * absence. Without it "Ọjọ́" became "Ọjọ": the acute accent is its own code
 * point, so a filter that keeps only letters and numbers silently rewrites
 * every Yoruba, Igbo, Vietnamese or Hindi name it touches. On a product built
 * in Nigeria that is not an edge case. What is left
 * is recognisably their file with `-cleaned` on it — which is worth the care,
 * because "holiday-cleaned.mp4" in a folder of thirty downloads is findable and
 * "frenz-ai-clean-9f2c1b8e.mp4" is not.
 */
export function cleanedFileName(sourceName: string | null): string {
  const base = (sourceName ?? "")
    .replace(/\.[^.]*$/, "")
    /*
      🔴 \p{M} — COMBINING MARKS — belongs here, and a test caught its absence.
      Without it "Ọjọ́" became "Ọjọ": the acute accent is its own code point, so
      an allow-list of letters and numbers alone silently rewrites every Yoruba,
      Igbo, Vietnamese or Hindi name it touches. On a product built in Nigeria
      that is not an edge case, it is the common one.
    */
    .replace(/[^\p{L}\p{M}\p{N} ._-]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);

  return base ? `${base}-cleaned.mp4` : "frenz-ai-cleaned-video.mp4";
}
