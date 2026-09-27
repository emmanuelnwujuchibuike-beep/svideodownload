/**
 * GET /api/ai/wallet/balance — the neutral door onto the one Frenz AI balance
 * (2026-09-27).
 *
 * Owner: "text to audio shouldnt go through character replace, character
 * replace should work alone." The wallet is shared by every paid tool and
 * always was; only its ADDRESS said otherwise. This re-exports the existing
 * handler rather than copying it, so there is still exactly one implementation
 * of reading a balance — the `/api/ai/character-replace/balance` path stays for
 * the clients already using it until the Kling migration retires them.
 */
export { GET, runtime, dynamic } from "@/app/api/ai/character-replace/balance/route";
