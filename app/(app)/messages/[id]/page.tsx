import { RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConversationRoom } from "@/features/social/conversation-room";
import { ThreadAppearanceProvider } from "@/features/social/thread-appearance-context";
import { ThreadHeader } from "@/features/social/thread-header";
import { getConversation, type ConversationView } from "@/lib/social/messages";
import { getActiveStoryForUser } from "@/lib/social/stories";
import { createClient, getUserBounded } from "@/lib/supabase/server";
import { withTimeout } from "@/lib/utils";

export const dynamic = "force-dynamic";

const LOAD_TIMEOUT_MS = 8000;
// Deliberately shorter than LOAD_TIMEOUT_MS: this page already chains a
// bounded auth check (getUserBounded, 6s) + the bounded conversation fetch
// above before ever reaching the stories fetch below, which is explicitly
// "best-effort, never blocks the thread" per its own comment there. Giving
// it the same 8s budget as the CRITICAL conversation fetch meant the
// page's real worst case (6s + 8s + 8s = 22s) comfortably exceeded even
// the service worker's own navigation timeout (public/sw/strategies.js),
// which then replaced this page's own graceful Retry state with a dead-end
// offline screen instead — a real bug found 2026-07-15. 4s keeps this
// fetch fast enough to matter for its purpose while shrinking the page's
// worst case well clear of that outer cutoff.
const STORY_TIMEOUT_MS = 4000;
const TIMED_OUT = Symbol("timed-out");

export const metadata: Metadata = {
  title: "Conversation",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Thread panel — fills the Glass Split right pane (full-screen on mobile). */
export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabase) redirect("/login");
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  // Time-boxed auth (docs/STARTUP_AUDIT.md): the data query below was
  // already raced against a timeout, but the auth call BEFORE it wasn't —
  // a stalled auth socket kept this page on its skeleton forever. A timeout
  // renders the same Retry state as a slow query; only a REAL "no session"
  // answer redirects to login.
  const auth = await getUserBounded(supabase);
  if (auth.kind === "signed-out") redirect(`/login?next=/messages/${id}`);
  if (auth.kind === "timeout") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-semibold">This is taking longer than usual</p>
        <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
        <Link href={`/messages/${id}`} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary">
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Link>
      </div>
    );
  }
  const user = auth.user;

  // Started BEFORE the conversation await so the two overlap — it depends only
  // on `user.id`. Not awaited here; see below.
  const viewerProfilePromise = supabase.from("profiles").select("display_name, handle").eq("id", user.id).maybeSingle();

  // Resolve the other participant with ONE cheap query so the story strip can
  // run ALONGSIDE the conversation fetch instead of after it.
  //
  // 2026-07-16 latency pass: `getActiveStoryForUser` used to be awaited after
  // `getConversation` (it needed `convo.other.id`), and it is not a single
  // query — it drags `excludedStoryAuthors`'s blocks/restriction checks with
  // it, several round trips of its own, all of them stacked onto the end of the
  // critical path for a secondary strip. Paying one small query up front to
  // overlap that whole chain is a clear win; the conversation row is tiny and
  // RLS-scoped to members, so it costs far less than it saves.
  const { data: convRow } = await supabase
    .from("conversations")
    .select("type, user_low, user_high")
    .eq("id", id)
    .maybeSingle();
  const otherId =
    convRow?.type === "direct"
      ? ((convRow.user_low as string | null) === user.id ? (convRow.user_high as string | null) : (convRow.user_low as string | null))
      : null;

  // Best-effort + time-boxed: a failed or slow stories fetch means no strip,
  // never a blocked thread. `withTimeout` here is deliberately SHORTER than the
  // conversation's — see STORY_TIMEOUT_MS.
  const storyPromise = otherId
    ? withTimeout(getActiveStoryForUser(otherId, user.id), STORY_TIMEOUT_MS, null).catch(() => null)
    : Promise.resolve(null);

  // A stuck/slow query here used to leave the whole thread — including its
  // header and composer — on the loading skeleton forever, with no way back
  // out short of a hard reload. Racing it turns that into a fast, honest
  // "couldn't load, try again" state after 8s instead.
  const convo = await withTimeout<ConversationView | null | typeof TIMED_OUT>(getConversation(id, user.id), LOAD_TIMEOUT_MS, TIMED_OUT);
  if (convo === TIMED_OUT) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-semibold">This is taking longer than usual</p>
        <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
        <Link href="/messages" className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary">
          <RefreshCw className="h-3.5 w-3.5" /> Back to Messages
        </Link>
      </div>
    );
  }
  if (!convo) notFound();
  // Secret Chats are ciphertext-only and only ever decrypted by the dedicated
  // /messages/secret/[id] room (SecretChatRoom) — this plaintext-assuming
  // route has no decryption path, so a bookmarked/deep-linked/pushed link
  // to a secret conversation id must bounce there instead of rendering raw
  // base64 ciphertext as if it were a normal message body.
  if (convo.type === "secret") redirect(`/messages/secret/${id}`);

  // Runs alongside the conversation fetch above rather than after it — it only
  // needs `user.id`. Part of the same 2026-07-16 latency pass: this page was
  // measured at 2.3-2.5s server-side, almost all of it stacked round trips.
  const { data: viewerProfile } = await viewerProfilePromise;
  const viewerName = (viewerProfile?.display_name as string) || (viewerProfile?.handle ? `@${viewerProfile.handle as string}` : "You");

  // Stories row embedded at the top of the thread (owner mockup) — direct
  // threads only, matching what the mockup itself shows (a single "Name · N
  // stories" strip); a group's several members each having stories is a
  // meaningfully different display this round didn't scope in. Best-effort:
  // a failed stories fetch just means no strip, never blocks the thread.
  // `getActiveStoryForUser`, NOT `getActiveStories` — the latter is scoped to
  // "public profiles only" (a real bug found 2026-07-13: it silently hid this
  // strip for any contact whose profile visibility isn't literally 'public',
  // which is most real accounts — being in a direct conversation together is
  // already a more intimate context than a public discovery feed).
  // `withTimeout` (2026-07-14): this call was "best-effort" only in comment,
  // never actually time-boxed — a real gap, made more likely to bite after
  // this same round added 4 MORE Supabase queries into its dependency chain
  // (excludedStoryAuthors, for the new blocks/status-restriction check). A
  // slow/hanging query anywhere in that chain hung the WHOLE thread page
  // indefinitely (a real "stuck on loading" report), since nothing here ever
  // raced it against a deadline the way `getConversation` above already is.
  //
  // ISSUED far above, in parallel with `getConversation` — only awaited here.
  // `convo.type` is still the authority on whether the strip renders at all:
  // the early `otherId` resolution is just a hint used to start the work, and a
  // group/secret thread resolves it to null anyway, so this can't show a strip
  // where the thread type says it shouldn't.
  const otherStoryGroup = convo.type === "direct" && convo.other ? await storyPromise : null;

  return (
    // Mobile: a true full-viewport overlay — covers the persistent app
    // topbar AND bottom nav (z-50, above MobileNav's z-40) so an open thread
    // is genuinely full-screen like a real chat app, not just "below the
    // nav." Desktop (lg:) reverts to normal in-flow behavior inside the
    // Glass Split layout, where the topbar/sidebar stay visible alongside
    // the inbox pane — that's a dashboard, not a full-screen navigation, so
    // it's deliberately left untouched there.
    <ThreadAppearanceProvider
      conversationId={convo.id}
      initialTheme={convo.theme}
      initialWallpaperUrl={convo.wallpaperUrl}
      initialAppearance={convo.appearance}
      className="fixed inset-0 z-50 flex min-h-0 flex-col bg-background bg-cover bg-center lg:static lg:inset-auto lg:z-auto lg:flex-1 lg:bg-transparent"
    >
      <ThreadHeader
        conversationId={convo.id}
        viewerId={user.id}
        type={convo.type}
        initialTitle={convo.title}
        initialAvatarUrl={convo.avatarUrl}
        initialMembers={convo.members}
        viewerRole={convo.viewerRole}
        other={convo.other}
        onlyAdminsCanSend={convo.onlyAdminsCanSend}
        initialDisappearAfterSeconds={convo.disappearAfterSeconds}
      />

      <ConversationRoom
        conversationId={convo.id}
        viewerId={user.id}
        viewerName={viewerName}
        viewerHandle={(viewerProfile?.handle as string | null) ?? null}
        initial={convo.messages}
        initialSyncedAt={convo.syncedAt}
        type={convo.type}
        members={convo.members}
        viewerRole={convo.viewerRole}
        onlyAdminsCanSend={convo.onlyAdminsCanSend}
        otherName={convo.other?.displayName ?? null}
        viewerTypingIndicatorsEnabled={convo.viewerTypingIndicatorsEnabled}
        otherStoryGroup={otherStoryGroup}
        initialAppearance={convo.appearance}
      />
    </ThreadAppearanceProvider>
  );
}
