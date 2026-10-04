/**
 * POST /api/ai/wallet/topup — the neutral door onto the one recharge flow
 * (2026-09-27). A re-export, not a second Paystack integration: see the note in
 * the balance route beside it.
 */
export { POST } from "@/app/api/ai/character-replace/topup/route";

/* Same reason as the balance route beside it: route segment config must be a
   statically readable literal, and a re-export is not one. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
