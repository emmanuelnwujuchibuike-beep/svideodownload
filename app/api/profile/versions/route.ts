import { NextResponse } from "next/server";
import { z } from "zod";

import { listVersions, restoreVersion } from "@/lib/social/profile-versions";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const schema = z.object({ versionId: z.string().regex(UUID) });

/** GET — the member's own layout history. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return NextResponse.json({ versions: await listVersions(user.id) });
}

/**
 * POST — restore a version's layout.
 *
 * The owner is taken from the SESSION and the version is looked up scoped to
 * them, so a valid uuid belonging to someone else resolves to nothing rather
 * than to their layout.
 *
 * Restoring does not delete history: the restore itself becomes the next
 * version on the following save, so a restore is as undoable as anything else.
 * An undo that cannot be undone is a trap.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Bad version id." }, { status: 400 });

  const result = await restoreVersion(user.id, parsed.data.versionId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
