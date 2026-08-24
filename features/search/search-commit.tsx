"use client";

import { createContext, useContext } from "react";

import type { SearchType } from "@/lib/social/search";

/**
 * "Run this search, right here, right now."
 *
 * ── 🔴 THE BUG THIS EXISTS TO KILL ────────────────────────────────────────
 * Owner report (2026-08-24): "the trending now search doesnt click — instead
 * when i back swipe is then entered the clicked search trending, and other
 * buttons does the same".
 *
 * Every one of those controls was a `<Link href="/search?q=…">` — a navigation
 * to the page you are ALREADY ON. Same-route navigation is the one case where
 * a link is the wrong tool: the router commits it, the URL changes, the server
 * re-runs, and the visible result is nothing at all until some later event
 * forces the screen to reconcile — which is what the back-swipe was doing.
 *
 * A search on the search page is not a navigation. It is a state change, and
 * this is how a server-rendered card three levels deep reaches it.
 *
 * ── Why a context reaches server components ───────────────────────────────
 * `SearchExperience` (client) provides it, and the discovery sections are
 * passed INTO it as `children`/props. Those sections stay server-rendered; the
 * small client leaves inside them (a tag card, a place row) are rendered within
 * the provider's subtree, so the context reaches them without any of the RSC
 * output becoming client JavaScript.
 */
export type SearchCommit = (term: string, type?: SearchType) => void;

const Ctx = createContext<SearchCommit | null>(null);

export const SearchCommitProvider = Ctx.Provider;

/**
 * Null only if a control is rendered outside the search page — in which case
 * the caller must fall back to a real link rather than swallow the tap.
 */
export function useSearchCommit(): SearchCommit | null {
  return useContext(Ctx);
}
