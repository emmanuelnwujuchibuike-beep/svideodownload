import { NextResponse } from "next/server";

import { sweepAiJobs } from "@/lib/ai/recovery";
import { cronAuthorized } from "@/lib/cron/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One page of live rows and one step each — never a backlog catch-up in one call. */
export const maxDuration = 120;

/**
 * The AI reconciliation sweep (Character Replace Part 5, §13 · §33).
 *
 * Finds the jobs nobody is polling — the member left the app, which is the
 * whole point of this Part — and moves each one step: a due finalization
 * retry is re-dispatched to the worker, a missed webhook is read from the
 * provider, a stalled row is ended and refunded, a pending announcement is
 * sent. Every step is the same idempotent function the live paths use
 * (lib/ai/recovery.ts), so running it beside a webhook changes nothing twice.
 *
 * Authorised exactly like every other cron here (lib/cron/auth.ts). NOT in
 * vercel.json — the Hobby plan's two cron slots are spent; GitHub Actions
 * (`.github/workflows/cron-ai-reconcile.yml`) is the clock, every ten
 * minutes, the same pattern as cron-ai-retention.
 */
async function run(request: Request) {
  if (!(await cronAuthorized(request))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await sweepAiJobs());
}

export const GET = run;
export const POST = run;
