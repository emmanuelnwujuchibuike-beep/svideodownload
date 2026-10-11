import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { MEMORY_CATEGORIES, FEELINGS, SOURCE_KINDS } from "@/lib/social/memories/engine";
import {
  archivedAndTrash,
  deleteCollection,
  dismiss,
  exportMemories,
  getMemory,
  historyMap,
  keepSuggestion,
  memoryLibrary,
  memorySuggestions,
  memoryVersions,
  restoreVersion,
  saveCollection,
  saveMemory,
  searchMemories,
  setState,
  sharedWithMe,
} from "@/lib/social/memories/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const uuid = z.string().uuid();

async function me(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * GET /api/memories?view=library|search|suggestions|archive|shared|versions|map|export
 * Every view is the session member's own memories, or ones they may see.
 */
export async function GET(req: Request) {
  const id = await me();
  if (!id) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const u = new URL(req.url);
  const view = u.searchParams.get("view") ?? "library";
  switch (view) {
    case "search":
      return NextResponse.json(await searchMemories(id, (u.searchParams.get("q") ?? "").slice(0, 200)), { headers: NO_STORE });
    case "suggestions":
      return NextResponse.json({ suggestions: await memorySuggestions(id) }, { headers: NO_STORE });
    case "archive":
      return NextResponse.json(await archivedAndTrash(id), { headers: NO_STORE });
    case "shared":
      return NextResponse.json({ memories: await sharedWithMe(id) }, { headers: NO_STORE });
    case "versions": {
      const mid = uuid.safeParse(u.searchParams.get("id"));
      return mid.success ? NextResponse.json({ versions: await memoryVersions(id, mid.data) }, { headers: NO_STORE }) : NextResponse.json({ error: "Bad id." }, { status: 400 });
    }
    case "one": {
      const mid = uuid.safeParse(u.searchParams.get("id"));
      const m = mid.success ? await getMemory(id, mid.data) : null;
      return m ? NextResponse.json({ memory: m }, { headers: NO_STORE }) : NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    case "map": {
      const lib = await memoryLibrary(id);
      return NextResponse.json({ map: historyMap(lib.memories) }, { headers: NO_STORE });
    }
    case "export":
      return new NextResponse(JSON.stringify(await exportMemories(id), null, 2), { headers: { ...NO_STORE, "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="frenz-memories.json"' } });
    default:
      return NextResponse.json(await memoryLibrary(id), { headers: NO_STORE });
  }
}

const categories = z.enum(Object.keys(MEMORY_CATEGORIES) as [keyof typeof MEMORY_CATEGORIES, ...(keyof typeof MEMORY_CATEGORIES)[]]);
const feelings = z.enum(Object.keys(FEELINGS) as [keyof typeof FEELINGS, ...(keyof typeof FEELINGS)[]]);
const memoryBody = z
  .object({
    id: uuid.optional(),
    title: z.string().max(120),
    note: z.string().max(4000).nullable().optional(),
    category: categories.optional(),
    occurredOn: z.string().max(10).optional(),
    place: z.string().max(120).nullable().optional(),
    feeling: feelings.nullable().optional(),
    linkUrl: z.string().max(600).nullable().optional(),
    visibility: z.enum(["private", "people", "friends", "circle"]).optional(),
    circleId: uuid.nullable().optional(),
    pinned: z.boolean().optional(),
    peopleIds: z.array(uuid).max(30).optional(),
    media: z.array(z.object({ kind: z.enum(["post", "image", "video", "link"]), postId: uuid.nullable().optional(), url: z.string().max(600).nullable().optional() }).strict()).max(20).optional(),
  })
  .strict();

const body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("save"), memory: memoryBody }).strict(),
  z.object({ op: z.literal("keep"), sourceKind: z.enum(SOURCE_KINDS), sourceRef: z.string().min(3).max(200) }).strict(),
  z.object({ op: z.literal("state"), id: uuid, action: z.enum(["archive", "unarchive", "delete", "restore", "purge", "pin", "unpin"]) }).strict(),
  z.object({ op: z.literal("restore_version"), id: uuid, version: z.number().int().min(1) }).strict(),
  z.object({ op: z.literal("dismiss"), key: z.string().min(5).max(220) }).strict(),
  z.object({ op: z.literal("collection"), id: uuid.optional(), title: z.string().max(80), description: z.string().max(400).nullable().optional(), visibility: z.enum(["private", "people", "friends"]).optional(), memoryIds: z.array(uuid).max(500).optional(), suggestionKey: z.string().max(120).nullable().optional() }).strict(),
  z.object({ op: z.literal("collection_delete"), id: uuid }).strict(),
]);

/** POST — every change to the session member's own memories. Nothing here acts for anyone else. */
export async function POST(req: Request) {
  const id = await me();
  if (!id) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const { success } = await trackLimiter.limit(`memories:${id}`);
  if (!success) return NextResponse.json({ ok: false, error: "Too many changes at once. Wait a moment." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  const b = parsed.data;
  const out =
    b.op === "save" ? await saveMemory(id, b.memory)
    : b.op === "keep" ? await keepSuggestion(id, b.sourceKind, b.sourceRef)
    : b.op === "state" ? await setState(id, b.id, b.action)
    : b.op === "restore_version" ? await restoreVersion(id, b.id, b.version)
    : b.op === "dismiss" ? await dismiss(id, b.key)
    : b.op === "collection" ? await saveCollection(id, b)
    : await deleteCollection(id, b.id);
  return out.ok ? NextResponse.json(out, { headers: NO_STORE }) : NextResponse.json({ ok: false, error: out.error }, { status: out.status });
}
