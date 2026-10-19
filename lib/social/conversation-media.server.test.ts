import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * "Media, links & files" (design/ChatMenu.dc.html, owner 2026-10-19). Through the real route on an
 * in-memory database: only an active member reads it, a deleted message gives up its media and links,
 * a Secret Chat's (encrypted) bodies are never read for links, and the pages continue by cursor.
 */

let db: FakeDb;
let sessionUser: { id: string } | null = null;

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }) }));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1);
const B = U(2);
const STRANGER = U(3);
const LEFT = U(4);
const CHAT = `20000000-0000-4000-8000-${"0".repeat(11)}1`;
const M = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (min: number) => new Date(Date.UTC(2026, 9, 19, 12, min)).toISOString();

function att(id: string, messageId: string, kind: string, min: number) {
  return { id, message_id: messageId, conversation_id: CHAT, idx: 0, media_kind: kind, media_url: `https://cdn.test/${id}`, thumbnail_url: null, media_width: 10, media_height: 10, duration_ms: null, filename: `${id}.bin`, mime_type: null, size_bytes: 100, created_at: at(min) };
}

beforeEach(() => {
  sessionUser = null;
  db = fakeDb({
    conversation_members: [
      { conversation_id: CHAT, user_id: A, left_at: null },
      { conversation_id: CHAT, user_id: B, left_at: null },
      { conversation_id: CHAT, user_id: LEFT, left_at: at(0) },
    ],
    messages: [
      { id: M(1), conversation_id: CHAT, body: "look https://example.com/a, and www", created_at: at(1), deleted_at: null, encryption_iv: null },
      { id: M(2), conversation_id: CHAT, body: "deleted https://gone.test", created_at: at(2), deleted_at: at(3), encryption_iv: null },
      { id: M(3), conversation_id: CHAT, body: "c2VjcmV0IGh0dHBzOi8vc2VjcmV0LnRlc3Q= http", created_at: at(4), deleted_at: null, encryption_iv: "iv" },
      { id: M(4), conversation_id: CHAT, body: "", created_at: at(5), deleted_at: null, encryption_iv: null },
      { id: M(5), conversation_id: CHAT, body: "", created_at: at(6), deleted_at: at(7), encryption_iv: null },
    ],
    message_attachments: [att("p1", M(4), "image", 5), att("v1", M(4), "video", 5), att("d1", M(4), "document", 5), att("a1", M(4), "audio", 5), att("p2", M(5), "image", 6)],
  });
});

async function get(tab: string, before?: string) {
  const { GET } = await import("@/app/api/conversations/[id]/media/route");
  const res = await GET(new Request(`http://t/api/conversations/${CHAT}/media?tab=${tab}${before ? `&before=${encodeURIComponent(before)}` : ""}`), { params: Promise.resolve({ id: CHAT }) });
  return { status: res.status, body: (await res.json()) as { items: { id: string; url: string; host?: string; kind?: string }[]; nextBefore: string | null } };
}

describe("who can read a chat's media", () => {
  it("signed out → 401; not a member, or left → 404 (never confirms the chat)", async () => {
    expect((await get("media")).status).toBe(401);
    sessionUser = { id: STRANGER };
    expect((await get("media")).status).toBe(404);
    sessionUser = { id: LEFT };
    expect((await get("media")).status).toBe(404);
  });

  it("a member reads it", async () => {
    sessionUser = { id: B };
    expect((await get("media")).status).toBe(200);
  });
});

describe("what each tab holds", () => {
  beforeEach(() => {
    sessionUser = { id: A };
  });

  it("media = photos and videos; a deleted message's are gone", async () => {
    const { body } = await get("media");
    expect(body.items.map((i) => i.id).sort()).toEqual(["p1", "v1"]);
  });

  it("files = documents and audio", async () => {
    const { body } = await get("files");
    expect(body.items.map((i) => i.id).sort()).toEqual(["a1", "d1"]);
  });

  it("links: from plain messages only — never a deleted one or a Secret Chat's encrypted body", async () => {
    const { body } = await get("links");
    expect(body.items.map((i) => i.url)).toEqual(["https://example.com/a"]);
    expect(body.items[0]!.host).toBe("example.com");
  });

  it("an unknown tab or a bad cursor is refused", async () => {
    expect((await get("everything")).status).toBe(400);
    expect((await get("media", "yesterday")).status).toBe(400);
  });

  it("pages continue by cursor: a full page names the next, the cursor skips what was shown", async () => {
    const { MEDIA_PAGE } = await import("./conversation-media");
    db.tables.message_attachments = Array.from({ length: MEDIA_PAGE + 5 }, (_, i) => att(`x${i}`, M(4), "image", 10 + i));
    const first = await get("media");
    expect(first.body.items).toHaveLength(MEDIA_PAGE);
    expect(first.body.nextBefore).not.toBeNull();
    const second = await get("media", first.body.nextBefore!);
    expect(second.body.items).toHaveLength(5);
    expect(second.body.nextBefore).toBeNull();
    const seen = new Set(first.body.items.map((i) => i.id));
    expect(second.body.items.some((i) => seen.has(i.id))).toBe(false);
  });
});

describe("links in a message", () => {
  it("each http(s) link once, trailing punctuation trimmed", async () => {
    const { linksIn } = await import("./conversation-media");
    expect(linksIn("see https://a.test/x), and https://a.test/x. also http://b.test!")).toEqual(["https://a.test/x", "http://b.test"]);
    expect(linksIn("no links, www.example.com")).toEqual([]);
  });
});
