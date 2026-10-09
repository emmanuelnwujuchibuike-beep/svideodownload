"use client";

import { useEffect } from "react";

import { useUser } from "@/features/auth/use-user";
import { revalidate, useQuery } from "@/features/data";
import { getCharacterReplaceBalance } from "@/lib/ai/character-replace/client";
import type { CharacterReplaceBalance, CharacterReplaceTransaction } from "@/lib/ai/character-replace/types";

/**
 * THE MEMBER'S WALLET, ONCE, FOR EVERY SCREEN THAT SHOWS IT.
 *
 * Owner, 2026-10-09: "the credit page and dashboard reload on every entry, is
 * not suppose too, it only supposed to revalidate and update instantly when a
 * balance update. And never reload the page."
 *
 * Both screens kept the wallet in their own component state: the credits page
 * started at null (a skeleton and a fetch on every entry); the AI dashboard's
 * credit strip painted an empty first frame and then never refreshed once
 * anything was cached. Now one cache key per member holds balance + statement:
 *
 *   · entry      paints the last-known wallet in the first frame, fetches nothing
 *   · a change   the member's own wallet row changes (a top-up, a transfer, a
 *                spend, a reward) → ONE realtime channel, shared by every screen
 *                showing the wallet, revalidates the key and every screen updates
 *   · cold start nothing cached yet → it loads once
 *
 * No polling, no focus refetch.
 */

export type WalletData = { balance: CharacterReplaceBalance; transactions: CharacterReplaceTransaction[] };

export const walletKey = (uid: string) => `ai-wallet:${uid}`;

async function fetchWallet(): Promise<WalletData> {
  const res = await getCharacterReplaceBalance({ ledger: 100 });
  if (!res.ok) throw new Error("wallet unavailable");
  return { balance: res.balance, transactions: res.transactions };
}

/** Force a re-read — after a payment return, a transfer, a plan change. */
export function refreshWallet(uid: string | null | undefined): Promise<unknown> {
  if (!uid) return Promise.resolve();
  return revalidate(walletKey(uid), fetchWallet, 0).catch(() => {});
}

/* ── one realtime channel for all consumers (ref-counted) ── */
let listeners = 0;
let stop: (() => void) | null = null;

/*
  🔴 The Supabase client (with realtime) is imported HERE, on demand — never at
  the top of this file. The credit strip that uses this hook sits on the
  cold-entry landing and /downloads; a static import put the whole realtime
  client into their first load (+68 kB gzipped, caught by lib/perf/budget.test.ts).
*/
function startChannel(uid: string): () => void {
  let closed = false;
  let close: (() => void) | null = null;
  void import("@/lib/supabase/client").then(({ createClient }) => {
    if (closed) return;
    const supabase = createClient();
    // A realtime topic is a global key — unique per open so a reopen never collides.
    const channel = supabase
      .channel(`wallet-balance:${uid}:${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_product_balances", filter: `user_id=eq.${uid}` }, () => void refreshWallet(uid))
      .subscribe();
    close = () => void supabase.removeChannel(channel);
  });
  return () => {
    closed = true;
    close?.();
  };
}

export function useWallet(): { data: WalletData | undefined; error: unknown; uid: string | null; refresh: () => Promise<unknown> } {
  const { user } = useUser();
  const uid = user?.id ?? null;
  const q = useQuery<WalletData>(walletKey(uid ?? "guest"), fetchWallet, {
    enabled: !!uid,
    revalidateOnFocus: false,
    revalidateOnMount: false,
  });

  useEffect(() => {
    if (!uid) return;
    listeners += 1;
    stop ??= startChannel(uid);
    return () => {
      listeners -= 1;
      if (listeners === 0) {
        stop?.();
        stop = null;
      }
    };
  }, [uid]);

  return { data: uid ? q.data : undefined, error: q.error, uid, refresh: () => refreshWallet(uid) };
}
