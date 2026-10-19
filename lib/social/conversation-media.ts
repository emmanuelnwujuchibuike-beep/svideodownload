import "server-only";

import type { AttachmentKind } from "@/lib/social/message-media";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * "Media, links & files" for one chat (design/ChatMenu.dc.html; owner 2026-10-19: "build any backend
 * attached that needs it for completion"). Three lists, newest first, a page at a time:
 *
 *   media   photos and videos sent in the chat
 *   links   web links written in messages (never a Secret Chat's: those bodies are encrypted end to end
 *           and the server can't — and mustn't — read them)
 *   files   documents and audio
 *
 * Exactly what the chat itself shows: only an ACTIVE member may read it, and a deleted message gives up
 * its attachments and its links (the thread shows it as deleted with nothing in it). Disappearing
 * messages are removed from the table when they expire, so they leave the lists the same moment.
 * Read with the service role and scoped here, as the thread read (`getConversation`) is.
 */

export type MediaTab = "media" | "links" | "files";
export const MEDIA_TABS: readonly MediaTab[] = ["media", "links", "files"];
export const MEDIA_PAGE = 60;

const KINDS: Record<Exclude<MediaTab, "links">, AttachmentKind[]> = { media: ["image", "video"], files: ["document", "audio"] };

export interface MediaItem {
  id: string;
  messageId: string;
  createdAt: string;
  kind: AttachmentKind;
  url: string;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

export interface LinkItem {
  id: string;
  messageId: string;
  createdAt: string;
  url: string;
  host: string;
}

export type MediaPage =
  | { tab: "links"; items: LinkItem[]; nextBefore: string | null }
  | { tab: "media" | "files"; items: MediaItem[]; nextBefore: string | null };

/** The same link shape the chat makes tappable (components/social/rich-text.tsx). */
const LINK_RE = /https?:\/\/[^\s<>"']+/gu;

/** Every http(s) link in a message body, trailing punctuation trimmed, each once. */
export function linksIn(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(LINK_RE)) {
    const url = m[0].replace(/[),.!?:;'"]+$/u, "");
    try {
      new URL(url);
    } catch {
      continue;
    }
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

type Db = ReturnType<typeof createAdminClient>;

async function isActiveMember(db: Db, conversationId: string, userId: string) {
  const { data } = await db.from("conversation_members").select("user_id").eq("conversation_id", conversationId).eq("user_id", userId).is("left_at", null).maybeSingle();
  return !!data;
}

/** Null when the viewer isn't an active member (the route answers 404, as the thread does). */
export async function listConversationMedia(conversationId: string, userId: string, tab: MediaTab, before?: string | null): Promise<MediaPage | null> {
  const db = createAdminClient();
  if (!(await isActiveMember(db, conversationId, userId))) return null;

  if (tab === "links") {
    let q = db
      .from("messages")
      .select("id, body, created_at, deleted_at, encryption_iv")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .is("encryption_iv", null)
      .ilike("body", "%http%")
      .order("created_at", { ascending: false })
      .limit(MEDIA_PAGE);
    if (before) q = q.lt("created_at", before);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as { id: string; body: string; created_at: string }[];
    const items: LinkItem[] = rows.flatMap((m) =>
      linksIn(m.body).map((url, i) => ({ id: `${m.id}:${i}`, messageId: m.id, createdAt: m.created_at, url, host: new URL(url).hostname.replace(/^www\./, "") })),
    );
    return { tab, items, nextBefore: rows.length === MEDIA_PAGE ? rows[rows.length - 1]!.created_at : null };
  }

  let q = db
    .from("message_attachments")
    .select("id, message_id, created_at, media_kind, media_url, thumbnail_url, media_width, media_height, duration_ms, filename, mime_type, size_bytes")
    .eq("conversation_id", conversationId)
    .in("media_kind", KINDS[tab])
    .order("created_at", { ascending: false })
    .limit(MEDIA_PAGE);
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string;
    message_id: string;
    created_at: string;
    media_kind: AttachmentKind;
    media_url: string;
    thumbnail_url: string | null;
    media_width: number | null;
    media_height: number | null;
    duration_ms: number | null;
    filename: string | null;
    mime_type: string | null;
    size_bytes: number | null;
  }[];

  // a deleted message keeps its attachment rows; the chat shows none of them, so neither does this
  const ids = [...new Set(rows.map((r) => r.message_id))];
  const { data: deleted } = ids.length ? await db.from("messages").select("id").in("id", ids).not("deleted_at", "is", null) : { data: [] };
  const gone = new Set(((deleted ?? []) as { id: string }[]).map((r) => r.id));

  const items: MediaItem[] = rows
    .filter((r) => !gone.has(r.message_id))
    .map((r) => ({
      id: r.id,
      messageId: r.message_id,
      createdAt: r.created_at,
      kind: r.media_kind,
      url: r.media_url,
      thumbnailUrl: r.thumbnail_url,
      width: r.media_width,
      height: r.media_height,
      durationMs: r.duration_ms,
      filename: r.filename,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
    }));
  return { tab, items, nextBefore: rows.length === MEDIA_PAGE ? rows[rows.length - 1]!.created_at : null };
}
