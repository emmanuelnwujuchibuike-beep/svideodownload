import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { sendFriendReminders } from "@/lib/social/friends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends due "Start chatting 👋" friend reminders. The hot-path opportunistic
 * runner in /api/friends usually beats this; the cron is the reliability net for
 * quiet periods. Authorised by the Vercel-cron bearer (CRON_SECRET) or an admin
 * session. Not registered in vercel.json by default (Hobby cron limits) — on a
 * plan that allows it, add a crons entry for this path with an every-10-minutes
 * schedule ("0/10 * * * *").
 */
async function authorized(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return !!(await getAdminUser());
}

async function run(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const sent = await sendFriendReminders();
  return NextResponse.json({ ok: true, sent });
}

export const GET = run;
export const POST = run;
