"use client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI CLEAN — the ONE piece of state this feature is allowed to keep locally
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-07 (Frenz AI Part 1): "Use Local Storage only for remembering
 * whether the user has already seen the tutorial."
 *
 * ── What may live here, and what may never ────────────────────────────────────
 *
 * Whether a person has watched a four-step explainer is a DEVICE fact: it is not
 * worth a row, it is not worth a round trip, and being wrong about it costs one
 * dismissable sheet. That is the same reasoning the theme and haptic preferences
 * use, and it is the only reason this file exists.
 *
 * 🔴 Nothing else about Frenz AI may be stored this way. Not Pro status, not the
 * daily allowance, not "the ad was watched". Those are all claims a visitor
 * would be able to grant themselves with one line in a console, and they already
 * have real homes: the plan comes from `/api/me`, and the credit allowance is
 * counted server-side in Redis (`lib/ai/quota.ts`, `consumeDailyUnits`).
 *
 * ── The key is the owner's, spelled exactly as specified ──────────────────────
 *
 * `frenzsave_frenz_ai_clean_tutorial_v1`. Every other key in this codebase uses
 * the shorter `frenz:` / `frenz_` prefix, so this one is deliberately different
 * and deliberately not "tidied" — the owner named it, a released key that
 * changes silently re-shows the tutorial to everyone who already dismissed it,
 * and `_v1` is there precisely so a future revision can choose to do that.
 *
 * ── Why there is an in-memory fallback ────────────────────────────────────────
 *
 * `localStorage` throws in a locked-down private window rather than returning
 * null. Without a fallback the tutorial would reopen on every navigation for
 * those visitors — the exact behaviour the owner asked to prevent. The module
 * variable makes the dismissal hold for the rest of the session, which is the
 * most that can honestly be promised when nothing can be written to disk. Same
 * shape as `lib/monetization/inpage-push-cap.ts`'s fallback counter.
 */

/** The storage key. Named by the owner — see the note above before changing it. */
export const AI_CLEAN_TUTORIAL_KEY = "frenzsave_frenz_ai_clean_tutorial_v1";

/**
 * `unseen`    — never opened it, so it opens by itself once.
 * `skipped`   — dismissed it. Never opens by itself again.
 * `completed` — reached the end. Never opens by itself again.
 *
 * Skipped and completed behave identically today. They are still stored apart
 * because "left early" and "read it all" are different facts about the same
 * person, and collapsing them now would throw away the only signal that could
 * ever say whether the tutorial is worth its length.
 */
export type AICleanTutorialState = "unseen" | "skipped" | "completed";

const KNOWN: readonly string[] = ["unseen", "skipped", "completed"];

/** Session fallback for when storage is unavailable — see the module note. */
let inMemory: AICleanTutorialState | null = null;

/**
 * A stored string turned into a state, honestly.
 *
 * Anything unrecognised — a truncated write, a value from a future release, a
 * key another script stamped on — reads as `unseen`. Failing toward "show the
 * explainer" is the harmless direction: the worst case is one sheet the visitor
 * skips, against silently hiding the only onboarding this feature has.
 */
export function parseAICleanTutorialState(raw: string | null | undefined): AICleanTutorialState {
  return typeof raw === "string" && KNOWN.includes(raw) ? (raw as AICleanTutorialState) : "unseen";
}

export function getAICleanTutorialState(): AICleanTutorialState {
  if (typeof window === "undefined") return "unseen";
  try {
    const raw = window.localStorage.getItem(AI_CLEAN_TUTORIAL_KEY);
    // A missing key with a session value set means storage rejected the write —
    // trust what this session already decided over the absence on disk.
    if (raw === null && inMemory !== null) return inMemory;
    return parseAICleanTutorialState(raw);
  } catch {
    return inMemory ?? "unseen";
  }
}

export function setAICleanTutorialState(state: AICleanTutorialState): void {
  inMemory = state;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_CLEAN_TUTORIAL_KEY, state);
  } catch {
    /* Private mode / storage full — the session fallback above still holds. */
  }
}

/** Whether the tutorial has already been skipped or completed on this device. */
export function hasSeenAICleanTutorial(): boolean {
  return getAICleanTutorialState() !== "unseen";
}

/**
 * Back to first-visit behaviour. Not wired to any button in the UI — the
 * "How it works" control replays the tutorial WITHOUT clearing the state, which
 * is a different thing. This exists for support ("make it show me again from
 * scratch") and for tests.
 */
export function resetAICleanTutorial(): void {
  inMemory = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AI_CLEAN_TUTORIAL_KEY);
  } catch {
    /* Nothing to remove if nothing could be written. */
  }
}
