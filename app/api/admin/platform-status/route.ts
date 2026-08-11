import { NextResponse } from "next/server";
import { z } from "zod";

import { getAdminUser } from "@/lib/admin/guard";
import { PLATFORMS } from "@/lib/platforms";
import { setPlatformStatus } from "@/lib/platform-status-store";
import type { PlatformStatusMap } from "@/lib/platform-status";
import type { PlatformId } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  Only the three real states, and only ids that are actually platforms.

  🔴 The id list comes from `PLATFORMS` rather than being a free string. This
  value is rendered on the public landing page, and an unbounded key would let a
  bad write grow the settings row without limit and put arbitrary text into a
  `Record` lookup that decides a CSS class.
*/
const platformId = z.enum(Object.keys(PLATFORMS) as [PlatformId, ...PlatformId[]]);

const entry = z.object({
  status: z.enum(["operational", "partial", "down"]),
  // Capped here as well as in `normalizePlatformStatus` — the store is the last
  // gate, but rejecting at the edge gives the operator a real error instead of
  // silently truncating what they typed.
  note: z.string().trim().max(140).optional(),
});

const schema = z.object({
  statuses: z.record(platformId, entry),
});

/** Admin-only: declare which download platforms are working right now. */
export async function POST(request: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid platform status payload." }, { status: 400 });
  }

  /*
    The timestamp is stamped SERVER-SIDE, never taken from the client.

    "Last changed" is the only thing that tells an operator a red badge is three
    weeks stale, so it has to be a fact rather than something the browser
    asserts. Every submitted platform is stamped now — the panel posts the whole
    map, and an operator pressing Save is confirming the current state of each
    one even where the value did not change.
  */
  const now = new Date().toISOString();
  const map: PlatformStatusMap = {};
  for (const [id, e] of Object.entries(parsed.data.statuses)) {
    if (!e) continue;
    map[id as PlatformId] = { status: e.status, updatedAt: now, ...(e.note ? { note: e.note } : {}) };
  }

  try {
    await setPlatformStatus(map);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't save platform status." }, { status: 500 });
  }
}
