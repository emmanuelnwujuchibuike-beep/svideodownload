import { NextResponse } from "next/server";

import { aiErrorBody, aiErrorStatus } from "@/lib/ai/errors";
import { primaryAiFeature } from "@/lib/ai/jobs";
import { resolveAiSubject } from "@/lib/ai/subject-server";
import { reconcileMemberTopupsWithin } from "@/lib/ai/wallet/reconcile-topups";
import { loadWalletSummary } from "@/lib/ai/wallet/summary";
import { getLandingSettings } from "@/lib/landing/settings";
import { aiJobReadLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/wallet/summary?transactions=N — the AI wallet page in one read
 * (credit brief §15): the balance in credits, the plan and its allowance, each
 * tool's availability, included generations and "from" cost, the Text to
 * Audio characters left, credits held by running creations, the recent
 * statement (typed as the brief names them, with balance before/after) and
 * the credit packs. The member's own, from the session — never a user id from
 * the request. Display only (lib/ai/wallet/summary.ts).
 */
export async function GET(request: Request) {
  const feature = primaryAiFeature();
  const { subject } = await resolveAiSubject(request, feature.id);
  if (!subject || subject.kind !== "user") return NextResponse.json(aiErrorBody("AUTH_REQUIRED"), { status: aiErrorStatus("AUTH_REQUIRED") });
  const burst = await aiJobReadLimiter.limit(`ai-wallet-summary:${subject.key}`);
  if (!burst.success) {
    return NextResponse.json(aiErrorBody("RATE_LIMITED"), { status: aiErrorStatus("RATE_LIMITED"), headers: { "Retry-After": String(Math.max(1, Math.ceil((burst.reset - Date.now()) / 1000))) } });
  }
  const param = Number(new URL(request.url).searchParams.get("transactions") ?? "");
  try {
    // a deposit paid or cancelled in a checkout the member never came back from is settled before the read (lib/ai/wallet/reconcile-topups.ts)
    const [settings] = await Promise.all([getLandingSettings(), reconcileMemberTopupsWithin(subject.userId)]);
    const summary = await loadWalletSummary(subject.userId, settings, { transactions: Number.isFinite(param) && param > 0 ? Math.floor(param) : 8 });
    return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    // 🔴 a wallet that cannot be read is NOT zero — the page says it could not load
    console.error("[ai/wallet/summary] read failed", { subject: subject.key, error: String(e).slice(0, 200) });
    return NextResponse.json(aiErrorBody("INTERNAL_ERROR"), { status: aiErrorStatus("INTERNAL_ERROR") });
  }
}
