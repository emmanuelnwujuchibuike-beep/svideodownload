"use client";

import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "WHO IS SIGNED IN?" IN THE BROWSER — answered once, from the device
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Measured on production 2026-10-07 (owner: "all buttons in the AI pages are
 * responding slow"): ONE signed-in AI page load sent `GET /auth/v1/user` to
 * Supabase NINE times — the notification bell, the live toasts, the
 * notification centre, presence, the status picker, the inbox and history
 * sync each asked the auth SERVER for the same id, over the network, while
 * the member was trying to tap.
 *
 * Every one of them only needs the member's id to scope a query or a
 * Realtime channel that the database authorises again with RLS. That id is
 * already on the device (the session cookie the server set). So this reads it
 * with `auth.getSession()` — local, no network — and shares ONE in-flight read
 * between every caller on the page. The shape is `getUser()`'s
 * (`{ data: { user } }`) so a call site changes by one line.
 *
 * ⚠️ Not for authorisation. Anything that decides access is the SERVER's, with
 * `auth.getUser()` there (lib/supabase/server.ts) — as every route already does.
 */
type AuthLike = { auth: Pick<SupabaseClient["auth"], "getSession" | "onAuthStateChange"> };

let inflight: Promise<{ data: { user: User | null } }> | null = null;
let listening = false;

export function getClientAuthUser(client: AuthLike): Promise<{ data: { user: User | null } }> {
  if (!listening) {
    listening = true;
    // a sign-in, sign-out or token refresh forgets the shared answer, so the next caller reads the new session
    try {
      client.auth.onAuthStateChange(() => {
        inflight = null;
      });
    } catch {
      /* the answer is still correct for this page; it is only not refreshed */
    }
  }
  if (!inflight) {
    inflight = client.auth
      .getSession()
      .then(({ data }) => ({ data: { user: data.session?.user ?? null } }))
      .catch(() => {
        inflight = null;
        return { data: { user: null } };
      });
  }
  return inflight;
}

/** Tests only. */
export function __resetClientAuthUser(): void {
  inflight = null;
  listening = false;
}
