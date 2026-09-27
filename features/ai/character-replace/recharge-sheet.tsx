/**
 * Moved to `features/ai/wallet/recharge-sheet.tsx` on 2026-09-27.
 *
 * Owner: "text to audio shouldnt go through character replace, character
 * replace should work alone." The sheet recharges the ONE Frenz AI balance
 * every paid tool spends, so it was never Character Replace's to own. This
 * re-export keeps the three existing importers working unchanged; new callers
 * import the wallet directly.
 */
export { AiWalletRechargeSheet, AiWalletRechargeSheet as CharacterReplaceRechargeSheet } from "@/features/ai/wallet/recharge-sheet";
