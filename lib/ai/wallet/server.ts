import "server-only";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE SHARED AI SPINE — the wallet, the kill switches, the breaker
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-27: "text to audio shouldnt go through character replace,
 * character replace should work alone … after now we will integrate the kling
 * ai."
 *
 * ── 🔴 WHAT WAS ACTUALLY WRONG ──────────────────────────────────────────────
 *
 * Three things were never Character Replace's, but lived in its folder because
 * it was the first paid tool built:
 *
 *   the WALLET      one Frenz AI balance (0155) that every paid tool spends
 *   the KILL SWITCHES  maintenance, the processing pause, launch mode — studio
 *                   wide, not one tool's
 *   the BREAKER     provider health, keyed by model, shared by every provider
 *
 * Because they lived there, Text to Audio, Lip Sync and Voice Cloning each had
 * to `import "@/lib/ai/character-replace/…"` to take money or read a switch —
 * which makes one tool a dependency of every other and is exactly what the
 * owner's standalone rule forbids. It also means a Character Replace refactor
 * can break three tools that have nothing to do with it.
 *
 * This module is the neutral spine every tool imports instead. It RE-EXPORTS
 * today rather than copying, so there is still exactly one implementation of
 * taking money — and when the Kling migration moves the implementations here
 * for real, this file's own exports do not change, so nothing downstream does
 * either. That is the point of putting the seam in before the move.
 *
 * ⚠️ This is a SPINE, not a pipeline. Nothing about how a tool does its work
 * belongs here: no provider, no model, no stage, no ffmpeg. A tool that wants
 * to share those with another tool is a tool that should be one tool.
 */

/* ── the one wallet ──────────────────────────────────────────────────────── */
export {
  getCharacterReplaceBalanceCents as getAiWalletBalanceCents,
  reserveCharacterReplaceCharge as reserveAiWalletCharge,
  settleCharacterReplaceCharge as settleAiWalletCharge,
} from "@/lib/ai/character-replace/wallet";

/* ── the studio-wide kill switches ───────────────────────────────────────── */
export { LAUNCH_INTERNAL_MESSAGE, launchAllows } from "@/lib/ai/character-replace/launch-server";

/* ── the provider circuit breaker, keyed by model ────────────────────────── */
export { providerHealthFor } from "@/lib/ai/character-replace/circuit";

/* ── how many jobs one member may run at once ────────────────────────────── */
export { concurrencyLimitFor } from "@/lib/ai/character-replace/config";

/* ── the finalizer's retry policy, shared by every tool that finalizes ───── */
export { finalizeBackoffMs, finalizeMaxAttempts } from "@/lib/ai/character-replace/finalize-policy";
