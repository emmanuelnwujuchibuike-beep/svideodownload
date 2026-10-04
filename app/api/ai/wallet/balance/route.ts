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
export { GET } from "@/app/api/ai/character-replace/balance/route";
/*
  🔴 `runtime` and `dynamic` are DECLARED HERE, not re-exported (2026-10-04).

  The build said so, on every single build:

    ⚠ Next.js can’t recognize the exported `runtime` field in
      "/api/ai/wallet/balance/route", it may be re-exported from another file.
      The default config will be used instead.

  Route segment config is read STATICALLY from the module. A re-export is not
  statically readable, so both values were silently dropped and the defaults
  applied — on a route that answers a member’s own wallet balance. Losing
  `force-dynamic` there is the kind of defect that only shows up as one member
  seeing a figure that belongs to a different request.

  The handler itself is still re-exported, so there is still exactly ONE
  implementation; only the two config literals are repeated, because literals
  are the only thing Next can read.
*/
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

