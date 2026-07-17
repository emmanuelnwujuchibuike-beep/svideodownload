/**
 * Who can see an account, and what an account may still do — as one rule, in one
 * place, so ~20 call sites can't drift apart on it.
 *
 * Two admin states, deliberately NOT the same thing (migration 0082):
 *
 *   is_suspended — a punishment. Full lockout: invisible to everyone including
 *                  themselves, and can't publish anything. Set by the report
 *                  queue's Suspend action.
 *   is_hidden    — a security/privacy measure, explicitly NOT a punishment.
 *                  Owner (2026-07-16): "user account that was hidden by admin
 *                  can interact, post, chat and everything, but to only people
 *                  they are already friends with ... the hide profile only
 *                  restrict them from users they are not friends with."
 *
 * So a hidden account keeps EVERY ability — post, comment, react, chat, story —
 * and is confined by REACH rather than by capability: nothing it does is visible
 * to a stranger, because strangers can't see the account at all. That's why
 * `canAccountPublish` ignores `isHidden`: blocking the action would be the wrong
 * mechanism and would also break its friendships, which is the one thing a hide
 * must preserve.
 *
 * `lib/social/account-visibility.test.ts` pins these rules. If a test there
 * fails, a hidden account is either leaking to strangers or being cut off from
 * its friends — treat it as a privacy regression, not a stale test.
 */

/** How the viewer relates to the account being rendered. Anonymous = "stranger". */
export type ViewerRelation = "self" | "friend" | "stranger";

export interface AccountFlags {
  isSuspended: boolean;
  isHidden: boolean;
}

/** Row shape as selected from `profiles` — snake_case straight out of PostgREST. */
export interface AccountFlagRow {
  is_suspended?: boolean | null;
  is_hidden?: boolean | null;
}

/** Normalise a raw profiles row (tolerating a missing column pre-migration). */
export function flagsOf(row: AccountFlagRow | null | undefined): AccountFlags {
  return { isSuspended: !!row?.is_suspended, isHidden: !!row?.is_hidden };
}

/**
 * Can `relation` see this account and anything it has authored?
 *
 * Suspension outranks hiding: an account that is both stays invisible even to
 * friends, because the punishment is the stronger statement.
 */
export function isAccountVisibleTo(account: AccountFlags, relation: ViewerRelation): boolean {
  if (account.isSuspended) return false;
  if (account.isHidden) return relation !== "stranger";
  return true;
}

/**
 * May this account create content (post / reel / story / comment / message)?
 *
 * Hidden accounts CAN — that is the entire point of the owner's rule. Only a
 * suspension takes the ability away.
 */
export function canAccountPublish(account: AccountFlags): boolean {
  return !account.isSuspended;
}

/** Convenience for the common `viewerId` + friend-set shape at call sites. */
export function relationTo(
  accountId: string,
  viewerId: string | null,
  friendIds: ReadonlySet<string>,
): ViewerRelation {
  if (viewerId && viewerId === accountId) return "self";
  if (viewerId && friendIds.has(accountId)) return "friend";
  return "stranger";
}

/**
 * The list-filter workhorse: given raw profile rows, the ids the viewer must NOT
 * see. Every feed/engagement/inbox surface reduces to this.
 */
export function invisibleAccountIds(
  rows: readonly (AccountFlagRow & { id: string })[],
  viewerId: string | null,
  friendIds: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    if (!isAccountVisibleTo(flagsOf(row), relationTo(row.id, viewerId, friendIds))) out.add(row.id);
  }
  return out;
}
