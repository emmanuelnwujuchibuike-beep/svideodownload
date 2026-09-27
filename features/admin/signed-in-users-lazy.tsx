"use client";

import dynamic from "next/dynamic";

/*
  🔴 CODE-SPLIT, and the route budget is why (lib/perf/budget.test.ts).

  Adding the signed-in members panel put /admin at 370 kB of gzipped JS against
  a 368 kB ceiling. The ceiling note, and `frenz-ai-settings-lazy.tsx` beside
  it, both say the same thing: the answer to an overflow is splitting a panel,
  not raising the number again. This is that split.

  ⚠️ THE SPLIT HAS TO HAPPEN INSIDE A CLIENT COMPONENT. A `next/dynamic` call
  from the server page moves nothing — a client boundary referenced by a page is
  bundled into that page's client chunk regardless. From here it is a real lazy
  chunk, fetched when the wrapper mounts.

  It also happens to be exactly what the owner asked for on 2026-09-27 — "do NOT
  simultaneously initialize download analytics, AI analytics, payment
  analytics…" — one step earlier than the polling gate: a section nobody has
  opened does not even download its code.

  The placeholder holds the section's height so nothing below it jumps while the
  chunk arrives.
*/
const SignedInUsersPanel = dynamic(
  () => import("@/features/admin/signed-in-users").then((m) => m.SignedInUsers),
  {
    loading: function Skeleton() {
      return (
        <div
          aria-busy="true"
          aria-label="Loading signed-in members"
          className="mt-6 min-h-[28rem] rounded-3xl border border-border bg-card"
        />
      );
    },
  },
);

export function SignedInUsersLazy() {
  return <SignedInUsersPanel />;
}
