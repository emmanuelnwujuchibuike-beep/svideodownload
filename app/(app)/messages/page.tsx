import { RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ConversationList } from "@/features/social/conversation-list";
import { InboxShell } from "@/features/social/inbox-shell";
import { WarmInboxFallback } from "@/features/social/warm-inbox-fallback";
import { listIncomingFriendRequests, type FriendRequestItem } from "@/lib/social/friends";
import { listConversations, type ConversationSummary } from "@/lib/social/messages";
import { createClient, getUserBounded } from "@/lib/supabase/server";
import { withTimeout } from "@/lib/utils";

type LoadResult = { ok: true; conversations: ConversationSummary[] } | { ok: false; conversations: ConversationSummary[] };

const LOAD_TIMEOUT_MS = 8000;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Messages",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * /messages index. Mobile: the full-screen inbox. Desktop: the inbox lives in
 * the layout's left pane, so this route shows an elegant empty-thread panel.
 *
 * IMPORTANT — this page is SYNCHRONOUS on purpose. It's the same fix the LAYOUT
 * already carries one level up (see MessagesLayout's note), applied to the page
 * that was still doing exactly what that comment warns about.
 *
 * Owner report (2026-07-16): "the message page still reloads too noticeable …
 * the message pages should never reload visibly when swiped back, instead it
 * should silently revalidate … no object including the profile button at the
 * top of the message page should never reload."
 *
 * That was right, and this was the cause. The page used to be `async` and
 * `await` the auth check + `listConversations` + `listIncomingFriendRequests`
 * before returning ANY JSX. An async page component suspends, so Next swaps the
 * WHOLE route for `loading.tsx` — the title, the subtitle and the header's
 * action circles (the "profile button at the top") included, even though none
 * of them depend on that data. Every re-render of this route therefore looked
 * like a full page reload rather than a refresh of the list.
 *
 * Now the shell renders in the first pass and only the LIST streams behind its
 * own <Suspense>; `loading.tsx` renders the SAME shell, so there is no visible
 * swap between the two states at all. `ConversationList` is seeded from the
 * shared client cache (features/data), so a warm re-entry paints the last-known
 * conversations immediately and revalidates silently in the background — the
 * "silently revalidate for current data and messages" half of the ask.
 */
export default function MessagesPage() {
  if (!hasSupabase) redirect("/login");

  return (
    <InboxShell>
      <Suspense fallback={<WarmInboxFallback />}>
        <InboxList />
      </Suspense>
    </InboxShell>
  );
}

/**
 * The list's data — streamed, never on the shell's render path. This is the
 * only part of the route that can suspend, so it's the only part that can ever
 * show a skeleton.
 */
async function InboxList() {
  const supabase = await createClient();
  // Time-boxed auth (docs/STARTUP_AUDIT.md) — a timeout renders the same
  // Retry state as a slow query below; only a real "no session" redirects.
  const auth = await getUserBounded(supabase);
  if (auth.kind === "signed-out") redirect("/login?next=/messages");

  // A stuck/slow query here used to leave the whole inbox on its loading
  // skeleton forever — nothing timed it out, so Next had nothing to fall
  // back to. Racing it means the WORST case is now "shows a retry prompt
  // after 8s", never "stuck indefinitely".
  const viewerId = auth.kind === "user" ? auth.user.id : "";
  const [result, requests] =
    auth.kind === "timeout"
      ? [{ ok: false as const, conversations: [] }, []]
      : await Promise.all([
          withTimeout<LoadResult>(
            listConversations(auth.user.id).then((c) => ({ ok: true, conversations: c })),
            LOAD_TIMEOUT_MS,
            { ok: false, conversations: [] },
          ),
          withTimeout<FriendRequestItem[]>(listIncomingFriendRequests(auth.user.id), LOAD_TIMEOUT_MS, []),
        ]);

  if (!result.ok) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 p-10 text-center">
        <p className="text-sm font-medium">This is taking longer than usual</p>
        <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
        <Link href="/messages" className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Link>
      </div>
    );
  }

  return <ConversationList initial={result.conversations} initialRequests={requests} viewerId={viewerId} />;
}
