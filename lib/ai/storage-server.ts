import "server-only";

import { AI_CLEAN_LIMITS } from "@/lib/ai/config";
import { AiJobError } from "@/lib/ai/errors";
import type { AiFeature } from "@/lib/ai/jobs";
import {
  AI_RESULT_BUCKET,
  AI_SIGNED_URL_TTL_SECONDS,
  AI_SOURCE_BUCKET,
  aiResultKey,
  aiSourceKey,
} from "@/lib/ai/storage";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — the private buckets, from the server side
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The path rules and the ownership check are pure and live in lib/ai/storage.ts.
 * This is the half that talks to Supabase, and it is the only half that can:
 * both buckets are private with no policy on `storage.objects`, so nothing
 * happens in them without the service role or a signed URL minted here.
 *
 * ── 🔴 THE CLIENT NEVER NAMES A PATH ─────────────────────────────────────────
 *
 * Every key is built server-side from the session's user id and the job's id.
 * The browser receives a signed URL that is already bound to one exact object —
 * it cannot be pointed at a different key, another member's folder, or a path
 * with `..` in it, because the path was never a parameter it supplied.
 *
 * ── Two very different lifetimes ─────────────────────────────────────────────
 *
 * The result link a member opens lives ten minutes. The source link REPLICATE
 * fetches lives two hours, because it has to survive a queue: a prediction that
 * waits forty minutes for a GPU and then finds a dead URL has burned the
 * member's allowance on a download that never happened. Different risks,
 * different numbers, both written down.
 */

/**
 * How long the provider's copy of the source stays fetchable.
 *
 * Two hours is a queue allowance, not a convenience: it is the window between
 * "Replicate accepted this" and "a GPU actually started it", which at busy
 * times is tens of minutes. The URL is single-purpose and unguessable, and it
 * is handed to one machine rather than published.
 */
export const AI_SOURCE_FETCH_TTL_SECONDS = 2 * 60 * 60;

export interface UploadTicket {
  /** The server-chosen object key. Echoed back so the job row can record it. */
  path: string;
  /** A one-object, short-lived PUT target. Carries its own auth in the query. */
  uploadUrl: string;
  /** Seconds the ticket is good for. */
  expiresIn: number;
}

/**
 * A signed upload target for one job's source video.
 *
 * The client PUTs the file straight to Supabase — the bytes never pass through
 * our server, which is the difference between a 100 MB upload costing us
 * nothing and costing us a serverless invocation holding 100 MB of memory.
 */
export async function createSourceUploadTicket(opts: {
  userId: string;
  feature: AiFeature;
  jobId: string;
  extension: string;
}): Promise<UploadTicket> {
  const path = aiSourceKey(opts.userId, opts.feature, opts.jobId, opts.extension);
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(AI_SOURCE_BUCKET).createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    console.error("[ai/storage] upload ticket failed", { jobId: opts.jobId, message: error?.message });
    throw new AiJobError("STORAGE_ERROR", error?.message ?? "no signed upload url");
  }

  return {
    path,
    uploadUrl: data.signedUrl.startsWith("http")
      ? data.signedUrl
      : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1${data.signedUrl}`,
    // Supabase signs upload URLs for two hours. Reported rather than assumed by
    // the client, so a change upstream does not silently shorten a member's
    // window mid-upload.
    expiresIn: AI_SOURCE_FETCH_TTL_SECONDS,
  };
}

export interface StoredObject {
  size: number;
  mimeType: string | null;
}

/**
 * What is actually sitting at that key — or null if nothing is.
 *
 * 🔴 The step that makes the client's claims irrelevant. Job creation accepts a
 * size and a MIME type from the browser so the interface can refuse an
 * impossible file early; this reads what was REALLY uploaded, and it is what
 * the entitlement and the provider call are gated on. A member who lies about a
 * 2 GB file being 2 MB gets caught here, before anything is charged.
 */
export async function statSourceObject(path: string): Promise<StoredObject | null> {
  const admin = createAdminClient();
  const slash = path.lastIndexOf("/");
  const folder = slash > 0 ? path.slice(0, slash) : "";
  const name = slash > 0 ? path.slice(slash + 1) : path;

  const { data, error } = await admin.storage.from(AI_SOURCE_BUCKET).list(folder, { search: name, limit: 2 });
  if (error) {
    console.error("[ai/storage] stat failed", { message: error.message });
    throw new AiJobError("STORAGE_ERROR", error.message);
  }

  const entry = (data ?? []).find((f) => f.name === name);
  if (!entry) return null;

  const meta = entry.metadata as { size?: number; mimetype?: string } | null;
  return {
    size: typeof meta?.size === "number" ? meta.size : 0,
    mimeType: typeof meta?.mimetype === "string" ? meta.mimetype : null,
  };
}

/** A link Replicate can fetch the source with. Long enough to survive a queue. */
export async function signSourceUrl(path: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(AI_SOURCE_BUCKET)
    .createSignedUrl(path, AI_SOURCE_FETCH_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new AiJobError("STORAGE_ERROR", error?.message ?? "no signed source url");
  }
  return data.signedUrl;
}

/**
 * A link to the SOURCE for the member to look at — not for a provider to fetch.
 *
 * 🔴 Deliberately NOT `signSourceUrl`. That one is signed for two hours because
 * Replicate may sit in a queue before it downloads; this one is opened by a
 * browser that is already on the page, so it gets the same short life as the
 * result. Reusing the long-lived link here would put a two-hour capability on a
 * private video into a URL bar, a browser history and a screenshot — for a
 * convenience worth ten minutes.
 */
export async function signSourceViewUrl(path: string): Promise<{ url: string; expiresIn: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(AI_SOURCE_BUCKET)
    .createSignedUrl(path, AI_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new AiJobError("STORAGE_ERROR", error?.message ?? "no signed source view url");
  }
  return { url: data.signedUrl, expiresIn: AI_SIGNED_URL_TTL_SECONDS };
}

/**
 * A link the MEMBER can open. Minutes, not hours — see the note at the top.
 *
 * ── 🔴 `downloadAs` IS WHAT MAKES DOWNLOADING ACTUALLY WORK ──────────────────
 *
 * Owner, 2026-09-08: "downloading the video dont work, it should follow the
 * normal download route."
 *
 * The result panel was doing `<a href={signedUrl} download="clean.mp4">`, and
 * the browser ignored the `download` attribute completely — because **the
 * attribute is only honoured for SAME-ORIGIN urls**. A Supabase signed URL is
 * `…supabase.co`, a different origin, so Chrome and Safari drop the attribute
 * and navigate to the file instead: the video opens and plays, and nothing is
 * saved. The rest of the app never hits this because its downloads proxy
 * through `/api/download`, which is same-origin.
 *
 * Supabase can set the header itself. `?download=<name>` on a signed URL makes
 * storage answer with `Content-Disposition: attachment; filename=…`, which a
 * browser obeys regardless of origin.
 *
 * ⚠️ Deliberately NOT solved by proxying the file through a route of ours. That
 * would work too, and it would pull every finished video through a serverless
 * function that bills by the millisecond and holds the whole stream in memory —
 * paying real money to re-add a header the storage layer will set for free.
 *
 * The filename is sanitised: it lands in a `Content-Disposition` header, and a
 * name carrying a quote or a newline is how a header gets split.
 */
export async function signResultUrl(
  path: string,
  downloadAs?: string,
): Promise<{ url: string; expiresIn: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(AI_RESULT_BUCKET)
    .createSignedUrl(
      path,
      AI_SIGNED_URL_TTL_SECONDS,
      downloadAs ? { download: safeDownloadName(downloadAs) } : undefined,
    );
  if (error || !data?.signedUrl) {
    throw new AiJobError("STORAGE_ERROR", error?.message ?? "no signed result url");
  }
  return { url: data.signedUrl, expiresIn: AI_SIGNED_URL_TTL_SECONDS };
}

/**
 * A filename safe to put in a `Content-Disposition` header.
 *
 * 🔴 Quotes, backslashes and any control character are removed rather than
 * escaped. This value originates in a filename the MEMBER chose, and a header
 * is exactly the wrong place to be clever: a stray `"` ends the quoted string
 * and a `\r\n` starts a new header. Stripping is the boring, safe answer.
 */
function safeDownloadName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- the point is to strip them
    .replace(/[\u0000-\u001F\u007F"\\;\r\n]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || "frenz-ai-clean.mp4";
}

/**
 * Bring the provider's output into our own private bucket.
 *
 * ── 🔴 Why copy it at all ────────────────────────────────────────────────────
 *
 * Replicate's output URL is public to anyone holding it and expires on their
 * schedule, not ours. Storing that URL on the job would mean a member's cleaned
 * video living at a public address we do not control, and a "your video is
 * ready" link that dies without warning. So the file is copied once, into a
 * bucket with no read policy at all, and every later access is a signed URL
 * minted after checking who is asking.
 *
 * ── The size guard is a memory guard ─────────────────────────────────────────
 *
 * The body is buffered to hand it to the storage client, so an unexpectedly
 * enormous output would be an out-of-memory crash in a webhook — which
 * Replicate would then retry, crashing again. `content-length` is checked
 * first when the provider sends one, and the buffered length is checked after
 * when it does not, because a missing header is not permission to buffer
 * anything at all.
 */
export async function storeResultFromUrl(opts: {
  userId: string;
  feature: AiFeature;
  jobId: string;
  sourceUrl: string;
}): Promise<{ path: string; size: number }> {
  const res = await fetch(opts.sourceUrl);
  if (!res.ok || !res.body) {
    throw new AiJobError("PROVIDER_ERROR", `output fetch ${res.status}`);
  }

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > AI_CLEAN_LIMITS.maxResultSize) {
    throw new AiJobError("STORAGE_ERROR", `output declared ${declared} bytes, over the ceiling`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > AI_CLEAN_LIMITS.maxResultSize) {
    throw new AiJobError("STORAGE_ERROR", `output was ${buffer.byteLength} bytes, over the ceiling`);
  }
  if (buffer.byteLength === 0) {
    throw new AiJobError("PROVIDER_ERROR", "output was empty");
  }

  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4";
  // The extension follows the URL when it is readable, because a member who
  // downloads their result should get a file their player opens.
  const urlExt = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(opts.sourceUrl)?.[1] ?? "mp4";
  const path = aiResultKey(opts.userId, opts.feature, opts.jobId, urlExt);

  const admin = createAdminClient();
  const { error } = await admin.storage.from(AI_RESULT_BUCKET).upload(path, buffer, {
    contentType,
    // A retried webhook re-uploads the same object rather than failing on a
    // duplicate key — the delivery is idempotent, so this has to be too.
    upsert: true,
  });
  if (error) {
    console.error("[ai/storage] result upload failed", { jobId: opts.jobId, message: error.message });
    throw new AiJobError("STORAGE_ERROR", error.message);
  }

  return { path, size: buffer.byteLength };
}
