/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  COMING BACK FROM A CREDIT TOP-UP CHECKOUT — what to tell the member (Part 4)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure: the answer of POST /api/ai/balance/topup/verify (which asks the provider and settles the attempt on the SERVER —
 * the browser never credits anything) turned into one honest message. Shared by every page a top-up can return to,
 * so the dashboard, the usage page and every AI workspace say the same thing.
 *
 *   credited     — the server settled it: credits are in.
 *   pending      — the provider has not confirmed it yet (bank transfer, USSD…): never "successful"; "Check again"
 *                  re-asks the SAME reference (a status check — it can never start a second payment).
 *   not_completed — the server holds no completed payment for it: nothing added. Not "nothing was charged" — a
 *                  member who sees money leave is told to contact support, never to pay again.
 *   unconfirmed  — the check itself failed (offline, server busy): unknown, NOT a failure; "Check again".
 */

export type TopupReturnState = "checking" | "credited" | "pending" | "not_completed" | "unconfirmed";

export interface TopupReturnView {
  state: TopupReturnState;
  title: string;
  text: string;
  /** a status check may be asked again (same reference, no new payment) */
  canRecheck: boolean;
}

/** The verify route's answer (lib/ai/character-replace/client.ts `verifyCharacterReplaceTopup`). */
export type TopupVerifyAnswer = { ok: true; credited?: boolean; pending?: boolean } | { ok: false; error?: string };

export const TOPUP_CHECKING: TopupReturnView = { state: "checking", title: "Checking your payment…", text: "We're confirming it with the payment provider.", canRecheck: false };

export function describeTopupReturn(answer: TopupVerifyAnswer): TopupReturnView {
  if (!answer.ok) {
    return { state: "unconfirmed", title: "We couldn't check your payment just now", text: "If you paid, your credits are added automatically once it clears — you don't need to pay again.", canRecheck: true };
  }
  if (answer.credited) {
    return { state: "credited", title: "Payment received", text: "Your credits have been added to your AI balance.", canRecheck: false };
  }
  if (answer.pending) {
    return { state: "pending", title: "Your payment is still being confirmed", text: "Credits are added the moment the provider confirms it — a bank transfer or USSD payment can take a few minutes. You don't need to pay again.", canRecheck: true };
  }
  return { state: "not_completed", title: "No credits were added", text: "That payment wasn't completed. If money left your account, contact support instead of paying again — it can be traced.", canRecheck: false };
}

/**
 * The return flow itself, free of React (so it is tested as is): `start` reads the reference ONCE (the reader removes it
 * from the address bar, so a reload or a back-swipe finds none and verifies nothing) and asks the server; `recheck` asks
 * about the SAME reference again — one check at a time, never a new payment. An AI-plan return is not a top-up: left
 * alone. A verify that throws is "couldn't check" (unknown), never a failure or a success.
 */
export function createTopupReturnController(deps: {
  hasPlanReturn: () => boolean;
  takeReference: () => string | null;
  verify: (reference: string) => Promise<TopupVerifyAnswer>;
  onView: (view: TopupReturnView) => void;
  onSettled?: () => void;
}) {
  let reference: string | null = null;
  let started = false;
  let inflight = false;
  const check = async (): Promise<boolean> => {
    if (!reference || inflight) return false;
    inflight = true;
    deps.onView(TOPUP_CHECKING);
    try {
      const answer = await deps.verify(reference).catch((): TopupVerifyAnswer => ({ ok: false }));
      deps.onView(describeTopupReturn(answer));
      deps.onSettled?.();
      return true;
    } finally {
      inflight = false;
    }
  };
  return {
    async start(): Promise<void> {
      if (started) return;
      started = true;
      if (deps.hasPlanReturn()) return;
      reference = deps.takeReference();
      await check();
    },
    recheck: check,
    get reference(): string | null {
      return reference;
    },
  };
}

/** The one-line form, for the pages that show a single sentence. */
export function topupReturnLine(answer: TopupVerifyAnswer): string {
  const v = describeTopupReturn(answer);
  return `${v.title}. ${v.text}`;
}
