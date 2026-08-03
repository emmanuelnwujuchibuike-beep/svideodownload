/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";

import { writeFile } from "node:fs/promises";

import { detectPlatform } from "@/lib/platforms";
import type { MediaFormat, TelegramMediaRef, VideoMetadata } from "@/types";

/**
 * Telegram MTProto service — authenticated downloads of PRIVATE + STORY content.
 *
 * The public embed extractor (server/extractors/telegram.ts) covers public channel
 * posts. This covers what the embed can't: Telegram Stories (`t.me/<user>/s/<id>`),
 * private channels/groups the account is a member of, and saved messages — videos,
 * photos, albums, documents, voice.
 *
 * ── Where it runs ─────────────────────────────────────────────────────────────
 * Only on the WORKER (the long-lived Docker process), which is where extraction +
 * download actually run and where the credentials live. On Vercel these routes
 * proxy to the worker, so this never executes there. GramJS is loaded with a
 * DYNAMIC import so it stays out of the frontend bundle entirely (and is marked
 * `serverExternalPackages` so webpack leaves it to the Node runtime).
 *
 * ── Credentials (worker env) ──────────────────────────────────────────────────
 *   TELEGRAM_API_ID    – from https://my.telegram.org
 *   TELEGRAM_API_HASH  – from https://my.telegram.org
 *   TELEGRAM_SESSION   – a StringSession, generated once via `node scripts/telegram-login.mjs`
 * With none set, `telegramMtprotoConfigured()` is false and callers fall back to
 * the public path — the feature is simply dormant, never an error.
 */

const API_ID = Number(process.env.TELEGRAM_API_ID || 0);
const API_HASH = process.env.TELEGRAM_API_HASH || "";
const SESSION = process.env.TELEGRAM_SESSION || "";

export function telegramMtprotoConfigured(): boolean {
  return API_ID > 0 && API_HASH.length > 0 && SESSION.length > 0;
}

/** The reference shape (shared with MediaFormat.telegramRef). */
export type TelegramRef = TelegramMediaRef;

/**
 * Parse a t.me link into a reference.
 *  - t.me/<user>/s/<id>       → a Story
 *  - t.me/<user>/<msgId>      → a channel/group message
 *  - t.me/c/<channelId>/<msg> → a private channel message
 */
export function parseTelegramUrl(raw: string): TelegramRef | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  if (!/(^|\.)t\.me$|telegram\.(me|org|dog)$/.test(host)) return null;
  const parts = u.pathname.split("/").filter(Boolean);

  // Private channel: /c/<channelId>/<messageId>
  if (parts[0] === "c" && parts[1] && parts[2] && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
    return { channelId: parts[1], messageId: Number(parts[2]) };
  }
  // Story: /<user>/s/<storyId>
  if (parts[0] && parts[1] === "s" && parts[2] && /^\d+$/.test(parts[2])) {
    return { username: parts[0], storyId: Number(parts[2]), isStory: true };
  }
  // Message: /<user>/<messageId>
  if (parts[0] && parts[1] && /^\d+$/.test(parts[1])) {
    return { username: parts[0], messageId: Number(parts[1]) };
  }
  return null;
}

/* ------------------------------------------------------------- client */

let clientPromise: Promise<{ client: any; Api: any }> | null = null;

async function getClient(): Promise<{ client: any; Api: any }> {
  if (!telegramMtprotoConfigured()) throw new Error("Telegram MTProto is not configured");
  if (!clientPromise) {
    clientPromise = (async () => {
      const { TelegramClient, Api } = await import("telegram");
      const { StringSession } = await import("telegram/sessions");
      const client = new TelegramClient(new StringSession(SESSION), API_ID, API_HASH, {
        connectionRetries: 3,
      });
      // Connects using the existing session — no interactive login at runtime.
      await client.connect();
      return { client, Api };
    })().catch((e) => {
      clientPromise = null; // allow a later retry after a transient connect failure
      throw e;
    });
  }
  return clientPromise;
}

async function resolveEntity(client: any, _Api: any, ref: TelegramRef): Promise<any> {
  // A public @username resolves directly and reliably (this is the Story path).
  if (ref.username) return client.getEntity(ref.username);
  // A private `t.me/c/<id>` link resolves only when the signed-in account is a
  // member (which it must be to see the content), so the dialog is cached. Pass
  // the raw id; a clear error surfaces upstream if it can't be resolved.
  if (ref.channelId) return client.getEntity(ref.channelId);
  throw new Error("Telegram reference has no peer");
}

/** Fetch the single message or story the ref points at, returning its media. */
async function fetchMedia(client: any, Api: any, ref: TelegramRef): Promise<{ media: any; caption: string | null; entity: any }> {
  const entity = await resolveEntity(client, Api, ref);
  if (ref.isStory && ref.storyId) {
    const res: any = await client.invoke(new Api.stories.GetStoriesByID({ peer: entity, id: [ref.storyId] }));
    const story = res?.stories?.[0];
    if (!story?.media) throw new Error("Story has no downloadable media (it may have expired or be private).");
    return { media: story.media, caption: story.caption ?? null, entity };
  }
  if (ref.messageId) {
    const msgs: any = await client.getMessages(entity, { ids: [ref.messageId] });
    const msg = msgs?.[0];
    if (!msg?.media) throw new Error("Message has no downloadable media.");
    return { media: msg.media, caption: msg.message ?? null, entity };
  }
  throw new Error("Telegram reference has no message or story id");
}

/* ------------------------------------------------------ metadata mapping */

function entityName(entity: any, ref: TelegramRef): string {
  return entity?.title || entity?.username || (ref.username ? `@${ref.username}` : "Telegram");
}

/** Map a Telegram media object to one of our download formats. */
function mediaToFormat(media: any, Api: any, ref: TelegramRef): MediaFormat {
  const cls = media?.className;
  const baseRef: TelegramRef = { ...ref };

  // Photo.
  if (cls === "MessageMediaPhoto" || media?.photo) {
    return {
      formatId: "tg-mt-0",
      kind: "image",
      label: "Photo",
      ext: "jpg",
      resolution: null,
      fps: null,
      filesize: null,
      tbr: null,
      vcodec: null,
      acodec: null,
      telegramRef: baseRef,
    };
  }

  // Document (video, gif, audio, voice, or a file).
  const doc = media?.document;
  const mime: string = doc?.mimeType || "";
  const attrs: any[] = doc?.attributes || [];
  const attr = (name: string) => attrs.find((a) => a?.className === name);
  const videoAttr = attr("DocumentAttributeVideo");
  const audioAttr = attr("DocumentAttributeAudio");
  const fileAttr = attr("DocumentAttributeFilename");
  const size = doc?.size != null ? Number(doc.size) : null;

  let kind: MediaFormat["kind"] = "video";
  let ext = "mp4";
  let label = "Video";
  let resolution: string | null = null;

  if (videoAttr || mime.startsWith("video/")) {
    kind = "video";
    ext = "mp4";
    label = attr("DocumentAttributeAnimated") ? "GIF" : "Video";
    if (videoAttr?.h) resolution = `${Number(videoAttr.h)}p`;
  } else if (audioAttr || mime.startsWith("audio/")) {
    kind = "audio";
    ext = audioAttr?.voice ? "ogg" : mime.includes("mpeg") ? "mp3" : "m4a";
    label = audioAttr?.voice ? "Voice" : "Audio";
  } else if (mime.startsWith("image/")) {
    kind = "image";
    ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    label = "Image";
  } else {
    // A non-A/V document (pdf, zip, …). Save it as-is with its real extension.
    kind = "video"; // pipeline's generic "file" bucket — streamed raw, not transcoded
    const fname: string = fileAttr?.fileName || "";
    ext = (fname.includes(".") ? fname.split(".").pop() : "") || "bin";
    label = fname || "File";
  }

  return {
    formatId: "tg-mt-0",
    kind,
    label,
    ext,
    resolution,
    fps: null,
    filesize: size,
    tbr: null,
    vcodec: null,
    acodec: null,
    telegramRef: baseRef,
  };
}

/** Pick the largest real (non-stripped) thumbnail from a media object, or null. */
function pickThumb(media: any): any | null {
  const thumbs: any[] = media?.document?.thumbs || media?.photo?.sizes || [];
  const usable = thumbs.filter((t) => t?.className !== "PhotoStrippedSize" && t?.className !== "PhotoPathSize");
  if (usable.length === 0) return thumbs[0] ?? null;
  usable.sort((a, b) => (b?.w ?? b?.size ?? 0) - (a?.w ?? a?.size ?? 0));
  return usable[0] ?? null;
}

/** Download a small cover thumbnail and return it as a data URI (CSP-safe, persists
 *  in history like a normal thumbnail URL). Best-effort — null on any failure. */
async function fetchThumbDataUri(client: any, media: any): Promise<string | null> {
  try {
    const thumb = pickThumb(media);
    if (!thumb) return null;
    const buf: any = await client.downloadMedia(media, { thumb });
    if (!buf || (buf.length ?? 0) === 0 || buf.length > 200_000) return null;
    return `data:image/jpeg;base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    return null;
  }
}

/** Resolve metadata for a private/story/authenticated Telegram URL via MTProto. */
export async function resolveTelegramViaMtproto(url: string): Promise<VideoMetadata> {
  const ref = parseTelegramUrl(url);
  if (!ref) throw new Error("Unrecognized Telegram URL");
  const { client, Api } = await getClient();
  const { media, caption, entity } = await fetchMedia(client, Api, ref);

  const format = mediaToFormat(media, Api, ref);
  const platform = detectPlatform(url);
  const name = entityName(entity, ref);
  const durationSec = media?.document?.attributes?.find((a: any) => a?.className === "DocumentAttributeVideo")?.duration ?? null;
  const thumbnail = await fetchThumbDataUri(client, media);

  return {
    id: `${ref.username || ref.channelId || "tg"}-${ref.storyId ?? ref.messageId ?? "0"}`,
    platform: platform.id,
    platformName: platform.name,
    sourceUrl: url,
    title: (caption?.trim() || (ref.isStory ? `${name} · Story` : name)).slice(0, 200),
    description: caption?.trim() || null,
    thumbnail,
    durationSeconds: durationSec != null ? Number(durationSec) : null,
    creator: name,
    uploadDate: null,
    viewCount: null,
    likeCount: null,
    webpageUrl: url,
    formats: [format],
    extractor: "telegram",
  };
}

const CONTENT_TYPE: Record<string, string> = {
  mp4: "video/mp4",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
};

/**
 * STREAM the media as it downloads, instead of buffering the whole file to disk
 * first. This is the fix for "it takes long to prepare the download": the browser
 * starts receiving bytes (and showing real progress) immediately, rather than
 * waiting ~20s for the server to pull the entire file before a single byte streams.
 * Chunks flow through a backpressured ReadableStream. The caller falls back to the
 * buffered path if setting this up fails.
 */
export async function downloadTelegramStream(
  ref: TelegramRef,
): Promise<{ stream: ReadableStream<Uint8Array>; ext: string; contentType: string; filesize: number }> {
  const { client, Api } = await getClient();
  const { media } = await fetchMedia(client, Api, ref);
  const format = mediaToFormat(media, Api, ref);
  const filesize = format.filesize ?? 0;

  // 512 KB parts (a multiple of 4096, within Telegram's per-request limit).
  const iter: any = client.iterDownload({ file: media, requestSize: 512 * 1024 });

  // CRITICAL: pull the FIRST chunk here, during setup. If iterDownload can't handle
  // this media (throws or yields nothing), it fails NOW — the caller catches it and
  // falls back to the buffered path. Without this the failure happens mid-response,
  // after 200 headers are already sent, which the client sees as a 502 with no
  // fallback (the bug this replaced).
  const firstResult = await iter.next();
  if (firstResult.done || !firstResult.value || (firstResult.value.length ?? 0) === 0) {
    throw new Error("Telegram stream produced no data");
  }
  let pending: Uint8Array | null = new Uint8Array(firstResult.value as Buffer);

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pending) {
        controller.enqueue(pending);
        pending = null;
        return;
      }
      try {
        const { value, done } = await iter.next();
        if (done || !value) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(value as Buffer));
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      try {
        await iter.close?.();
      } catch {
        /* best-effort */
      }
    },
  });

  return { stream, ext: format.ext, contentType: CONTENT_TYPE[format.ext] ?? "application/octet-stream", filesize };
}

/**
 * Download the media the ref points at, straight to `finalPath` via the
 * authenticated client. The buffered fallback for `downloadTelegramStream`.
 */
export async function downloadTelegramMedia(
  ref: TelegramRef,
  finalPath: string,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  const { client, Api } = await getClient();
  const { media } = await fetchMedia(client, Api, ref);
  const buffer: any = await client.downloadMedia(media, {
    progressCallback: (downloaded: any, total: any) => {
      try {
        onProgress?.(Number(downloaded), Number(total));
      } catch {
        /* progress is best-effort */
      }
    },
  });
  if (!buffer || (buffer.length ?? 0) === 0) {
    throw new Error("Telegram returned no bytes for this media");
  }
  await writeFile(finalPath, buffer as Buffer);
}
