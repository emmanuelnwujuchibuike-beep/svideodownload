import { NextResponse } from "next/server";
import { z } from "zod";

import { trackLimiter } from "@/lib/rate-limit";
import { relationshipBetween } from "@/lib/social/graph/context";
import { graphGrowth, graphHistory, graphSearch } from "@/lib/social/graph/graph-server";
import { can, GRAPH_ACTIONS, type GraphAction } from "@/lib/social/graph/permissions";
import { trustFor } from "@/lib/social/graph/trust-server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const uuid = z.string().uuid();

/**
 * GET /api/graph — the Graph API Platform™ (Feature 19 · Part 15), for the
 * signed-in member only:
 *   view=context&id=<user>     how you're connected (Context Engine)
 *   view=can&action=&id=       may you do this to them, and why (Permission Graph)
 *   view=trust                 your own trust band and its reasons (Trust Graph)
 *   view=search&q=             natural search over your network
 *   view=growth                your private network growth, 12 months
 *   view=history&before=       your private graph history
 * Every view answers about the asker's own network. Trust is only ever your own.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const u = new URL(req.url);
  const view = u.searchParams.get("view");
  const ok = (body: unknown) => NextResponse.json(body, { headers: NO_STORE });
  switch (view) {
    case "context": {
      const id = uuid.safeParse(u.searchParams.get("id"));
      return id.success ? ok(await relationshipBetween(user.id, id.data)) : NextResponse.json({ error: "Bad id." }, { status: 400 });
    }
    case "can": {
      const id = uuid.safeParse(u.searchParams.get("id"));
      const action = u.searchParams.get("action") as GraphAction;
      if (!id.success || !GRAPH_ACTIONS.includes(action)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
      return ok(await can(user.id, action, id.data));
    }
    case "trust":
      return ok({ trust: await trustFor(user.id) });
    case "search": {
      const { success } = await trackLimiter.limit(`graph-search:${user.id}`);
      if (!success) return NextResponse.json({ error: "Too many searches. Wait a moment." }, { status: 429 });
      return ok(await graphSearch(user.id, (u.searchParams.get("q") ?? "").slice(0, 160)));
    }
    case "growth":
      return ok(await graphGrowth(user.id));
    case "history":
      return ok(await graphHistory(user.id, u.searchParams.get("before")));
    default:
      return NextResponse.json({ error: "Unknown view." }, { status: 400 });
  }
}
