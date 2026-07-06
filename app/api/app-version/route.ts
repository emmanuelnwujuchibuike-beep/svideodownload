import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The running deployment's build stamp (baked at build time in next.config.ts).
 * Clients — critically, installed PWAs whose resumed pages can outlive many
 * deploys — poll this on resume/focus and reload themselves when it changes,
 * so a deploy reaches every home-screen install without a delete/re-add.
 */
export function GET() {
  return NextResponse.json(
    { build: process.env.NEXT_PUBLIC_APP_BUILD ?? "" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
