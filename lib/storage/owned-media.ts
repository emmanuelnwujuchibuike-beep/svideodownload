import { POST_BUCKET, type StorageBackend } from "./buckets";

/**
 * Which uploaded file a media URL names, and whose it is — read from the URL alone.
 *
 * Every member upload goes through `/api/uploads/presign`, which keys the object
 * `<uploader id>/<kind>s/<timestamp>-<random>.<ext>` (`buildMediaKey`) and serves it
 * from R2's public base, or from the Supabase `post-media` bucket when R2 is not
 * configured. So the uploader is the key's first segment, and the server can tell
 * a member's own upload from another member's file, or from any web address at
 * all, without a lookup.
 *
 * Stories Part 1 (2026-10-26, audit S3): `POST /api/stories` accepted ANY URL, so a
 * member could publish someone else's file, or a tracking image on another site
 * that would learn every viewer's address. A story's media must now be the
 * member's own upload of the right kind, and the expiry sweep uses the same
 * reading to decide which files it may ever delete.
 *
 * Pure: the bases are passed in, so tests need no environment.
 */

/** `stories` is a retired folder older story uploads used (mixed kinds). New uploads never land there. */
export type UploadFolder = "images" | "videos" | "stories";

export interface StoredUpload {
  backend: StorageBackend;
  /** The object key, exactly as stored. */
  key: string;
  /** The uploader — the key's first segment. */
  ownerId: string;
  folder: UploadFolder;
}

export interface StorageBases {
  /** R2_PUBLIC_BASE_URL, without a trailing slash. */
  r2PublicBase?: string | null;
  /** NEXT_PUBLIC_SUPABASE_URL, without a trailing slash. */
  supabaseUrl?: string | null;
}

/**
 * The key shapes member uploads have actually had, read off every story row on
 * production (2026-10-26): `<uid>/images/<ts>-<rand>.jpg` (buildMediaKey today),
 * `<uid>/images/<ts>-<rand>-poster.jpg` (a captured cover), `<uid>/images/<ts>.jpg`,
 * and the older `post-media/<uid>/{images,videos,stories}/…` layout. Every one
 * starts with the uploader's id. A key WITHOUT an owner id (two old covers,
 * `post-media/images/<ts>-poster.jpg`) cannot be attributed, so it never parses —
 * and therefore can never be published as a story nor deleted by the sweep.
 */
const UPLOAD_KEY =
  /^(?:post-media\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(images|videos|stories)\/[0-9]{10,16}(?:-[a-z0-9]{1,16}){0,3}\.[a-z0-9]{1,5}$/;

const trim = (s: string | null | undefined) => (s ?? "").trim().replace(/\/+$/, "");

/** The uploaded photo or video a URL names in OUR storage, or null for anything else. */
export function parseUploadUrl(raw: string | null | undefined, bases: StorageBases): StoredUpload | null {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // a query or fragment is not part of any key we hand out
  if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) return null;
  // exactly the URL we hand out: `..` segments or anything the parser would rewrite never pass
  if (url.href !== raw) return null;

  const candidates: { backend: StorageBackend; prefix: string }[] = [];
  const r2 = trim(bases.r2PublicBase);
  if (r2) candidates.push({ backend: "r2", prefix: `${r2}/` });
  const sb = trim(bases.supabaseUrl);
  if (sb) candidates.push({ backend: "supabase", prefix: `${sb}/storage/v1/object/public/${POST_BUCKET}/` });

  const href = `${url.origin}${url.pathname}`;
  for (const { backend, prefix } of candidates) {
    if (!href.startsWith(prefix)) continue;
    let key: string;
    try {
      key = decodeURIComponent(href.slice(prefix.length));
    } catch {
      return null;
    }
    const m = UPLOAD_KEY.exec(key);
    if (!m) return null;
    return { backend, key, ownerId: m[1]!, folder: m[2] as UploadFolder };
  }
  return null;
}

/** Is this URL the given member's own uploaded photo (`image`) or video (`video`)? Only today's folders count for a NEW story. */
export function isOwnUpload(raw: string | null | undefined, userId: string, kind: "image" | "video", bases: StorageBases): boolean {
  const up = parseUploadUrl(raw, bases);
  return !!up && up.ownerId === userId.toLowerCase() && up.folder === (kind === "image" ? "images" : "videos");
}

/** The bases this deployment serves uploads from. Server-side only (reads env). */
export function storageBasesFromEnv(): StorageBases {
  return { r2PublicBase: process.env.R2_PUBLIC_BASE_URL ?? null, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null };
}
