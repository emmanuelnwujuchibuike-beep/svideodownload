import { NextResponse } from "next/server";

import { getAdminUser } from "@/lib/admin/guard";
import { checkAndNotifyMissingDailyWallpaper } from "@/lib/analytics/wallpaper-reminder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily 10am check: has an admin-curated wallpaper been uploaded today? If
 * not, alert (push + email). Intended schedule: `0 10 * * *` (10am UTC — see
 * the same UTC-not-local note on `cron/digest/route.ts`).
 *
 * NOT registered in vercel.json: same 2-cron Hobby-plan limit already spent
 * by `trending` and `profile-snapshots` (see `abandoned-downloads/route.ts`
 * and `cron/digest/route.ts` for the same situation). Trigger externally with
 * the `CRON_SECRET` bearer header, or fold into whichever scheduler ends up
 * covering the other unregistered crons.
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
  const result = await checkAndNotifyMissingDailyWallpaper();
  return NextResponse.json({ ok: true, ...result });
}

export const GET = run;
export const POST = run;
