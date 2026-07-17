import { cache } from "react";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The viewer's friend ids as a Set, deduped per request via React `cache()`.
 *
 * Its own module, rather than a sibling of the rest of `friends.ts`, for two
 * reasons: `friends.ts` pulls in messages + web-push and would create an import
 * cycle for the read paths that need this (profile, feeds, stories, search);
 * and `account-visibility.ts` must stay a pure, DB-free rule module so it can be
 * unit-tested. This is the one small thing that touches the DB.
 *
 * Needed because migration 0082 made "hidden" mean friends-only, so nearly every
 * read surface now has to ask "is the viewer a friend of this author?".
 *
 * Fails to an EMPTY set, which reads every hidden account the way a stranger's
 * viewer would — i.e. a DB blip hides more, never less. The safe direction for
 * a privacy rule.
 */
export const friendIdSet = cache(async (userId: string | null): Promise<ReadonlySet<string>> => {
  if (!userId) return new Set<string>();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return new Set<string>();
  try {
    const { data } = await createAdminClient()
      .from("friendships")
      .select("user_low, user_high")
      .or(`user_low.eq.${userId},user_high.eq.${userId}`);
    return new Set(
      ((data as { user_low: string; user_high: string }[]) ?? []).map((r) =>
        r.user_low === userId ? r.user_high : r.user_low,
      ),
    );
  } catch {
    return new Set<string>();
  }
});
