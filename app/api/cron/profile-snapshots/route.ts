import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Daily profile snapshots — the series that makes Growth Insights honest.
 *
 * Parts 4-5 and Part 15 both refused to draw a trend because nothing recorded
 * history. This writes ONE row per member per day (`profile_snapshots`, 0110),
 * and `lib/profile/growth.ts` reads it. Until a member has two days of rows they
 * have no trend, and the UI says exactly that rather than drawing a flat line.
 *
 * ── Why it is bounded, and what happens when it hits the bound ─────────────
 * This is the only job in the product that touches every member, so it is the
 * one most able to turn into an unbounded bill. It processes members in pages
 * with a hard ceiling, and it snapshots ACTIVE members first (most recently
 * updated). If the ceiling is reached the rest simply wait for tomorrow — a
 * missing day in someone's chart is a far better failure than a cron that runs
 * for an hour.
 *
 * Idempotent: the primary key is (user_id, captured_on) and the write is an
 * upsert, so running it twice in a day overwrites rather than duplicating.
 */

const MAX_MEMBERS = 5_000;
const PAGE = 500;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function GET(request: Request) {
  // Vercel Cron signs its requests; anything else must present the secret.
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const isVercelCron = request.headers.get("x-vercel-cron") !== null;
  if (!isVercelCron && (!secret || auth !== `Bearer ${secret}`)) return unauthorized();

  const db = createAdminClient();
  const capturedOn = new Date().toISOString().slice(0, 10);
  let written = 0;
  let scanned = 0;

  try {
    for (let from = 0; from < MAX_MEMBERS; from += PAGE) {
      const { data, error } = await db
        .from("profiles")
        .select("id, followers_count, following_count")
        .order("updated_at", { ascending: false, nullsFirst: false })
        .range(from, from + PAGE - 1);
      if (error) break;

      const rows = (data ?? []) as { id: string; followers_count: number | null; following_count: number | null }[];
      if (rows.length === 0) break;
      scanned += rows.length;

      /*
        Counts come from ONE grouped query per page rather than per member.
        A per-member query here would be 5,000 round trips a night for a
        vanity chart — the exact shape of cost this codebase keeps finding.
        Anything unavailable stays 0; a snapshot with a missing metric is
        still a valid point in the series.
      */
      const ids = rows.map((r) => r.id);
      const counts = new Map<string, { posts: number; collections: number }>();
      const [{ data: posts }, { data: collections }] = await Promise.all([
        db.from("posts").select("publisher_id").in("publisher_id", ids).eq("status", "published").limit(20_000),
        db.from("collections").select("owner_id").in("owner_id", ids).limit(20_000),
      ]);
      for (const p of (posts ?? []) as { publisher_id: string }[]) {
        const c = counts.get(p.publisher_id) ?? { posts: 0, collections: 0 };
        c.posts += 1;
        counts.set(p.publisher_id, c);
      }
      for (const c of (collections ?? []) as { owner_id: string }[]) {
        const e = counts.get(c.owner_id) ?? { posts: 0, collections: 0 };
        e.collections += 1;
        counts.set(c.owner_id, e);
      }

      const snapshots = rows.map((r) => {
        const c = counts.get(r.id) ?? { posts: 0, collections: 0 };
        return {
          user_id: r.id,
          captured_on: capturedOn,
          posts: c.posts,
          followers: r.followers_count ?? 0,
          following: r.following_count ?? 0,
          friends: 0,
          collections: c.collections,
          reputation: 0,
          health_score: null,
        };
      });

      const { error: writeError } = await db
        .from("profile_snapshots")
        .upsert(snapshots, { onConflict: "user_id,captured_on" });
      if (writeError) break;
      written += snapshots.length;

      if (rows.length < PAGE) break;
    }
  } catch {
    // A partial run is fine — tomorrow's fills in, and the series tolerates
    // a gap far better than the job failing loudly and being disabled.
  }

  return NextResponse.json({ ok: true, capturedOn, scanned, written });
}
