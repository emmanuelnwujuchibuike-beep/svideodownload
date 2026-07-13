import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SecretChatsPanel } from "@/features/social/secret-chats-panel";
import { isPinLocked } from "@/lib/security/pin-gate";
import { createClient, getUserBounded } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Secret Chats",
  robots: { index: false, follow: false },
};

/**
 * Secret Chats index (Part 11b). Deliberately its own route, not a tab on
 * /messages — "Hidden Chat" (spec) means it's reached by deliberate
 * navigation, not visible in the normal inbox at all (listConversations()
 * excludes type='secret' server-side, not just in this page's UI).
 * SSR-gated via lib/security/pin-gate.ts — real content never ships in the
 * HTML while locked. Deliberately the ONLY messaging surface still behind
 * the account PIN (owner correction 2026-07-13): general /messages used to
 * share this same gate, requiring a PIN just to open normal chats — now
 * scoped to Secret Chats + /account/security only (see GATED_PREFIXES in
 * features/account/pin-lock-gate.tsx).
 */
export default async function SecretChatsPage() {
  const supabase = await createClient();
  const auth = await getUserBounded(supabase);
  if (auth.kind === "signed-out") redirect("/login?next=/messages/secret");
  if (auth.kind === "timeout") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-semibold">This is taking longer than usual</p>
        <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
      </div>
    );
  }

  if (await isPinLocked(auth.user.id)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Lock className="h-6 w-6" />
        </span>
        <p className="text-sm font-semibold">Secret Chats locked</p>
        <p className="max-w-xs text-sm text-muted-foreground">Enter your PIN to view your Secret Chats.</p>
      </div>
    );
  }

  return <SecretChatsPanel />;
}
