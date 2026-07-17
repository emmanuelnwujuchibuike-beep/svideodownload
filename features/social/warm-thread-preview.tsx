"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { getEntry } from "@/features/data";
import { INBOX_KEY, type Inbox } from "@/features/social/inbox";
import { getCachedThread } from "@/features/social/thread-cache";
import { cn } from "@/lib/utils";

const THREAD_PATH = /^\/messages\/([0-9a-f-]{36})$/i;

/**
 * Paints an already-warmed thread DURING the route transition, instead of the
 * grey skeleton.
 *
 * THE PROBLEM THIS EXISTS FOR (owner, 2026-07-17, with a screenshot of the grey
 * skeleton): "why does every chat entry loads? ... we said to make chats warm up
 * ... it should never show a white screen when entering."
 *
 * The inbox warms the top 10 threads (`warmThread`), and `ConversationRoom` does
 * read that cache — but `/messages/[id]` is an ASYNC SERVER page, so tapping a
 * chat means: RSC request -> phone to Vercel -> await auth + getConversation ->
 * stream back -> and only THEN does ConversationRoom mount and read the cache.
 * The skeleton covers that entire round trip, and by the time the cache is read
 * the server has already sent the same data. The warm-up saved nothing; it just
 * spent the user's data.
 *
 * `loading.tsx` is the only place that can fix it, because it is the only thing
 * that renders BEFORE the RSC round trip — it's already in the client bundle and
 * the router paints it immediately. So the warm data gets used at the one moment
 * it's actually worth something.
 *
 * WHY NOT `router.prefetch()` — the idiomatic Next answer, and a trap here:
 * prefetching `/messages/<id>` runs the page on the server, which calls
 * `getConversation` WITHOUT `peek`, and that marks the other side's messages
 * READ as a side effect. Prefetching would silently mark chats "Seen" that the
 * user never opened. That exact bug already got one warm-up deleted; `warmThread`
 * uses `?peek=1` precisely to avoid it. This component reuses that peeked data,
 * so it reads nothing and claims nothing.
 *
 * Deliberately READ-ONLY and side-effect free: no realtime subscription, no
 * mark-as-read, no composer wiring. It is unmounted the moment the real page
 * streams in, and mounting the real ConversationRoom here would double-subscribe
 * and re-run those side effects for a view that's about to be thrown away.
 *
 * It renders the DEFAULT bubble appearance. A user with a custom bubble
 * shape/colour sees their own styling apply when the real room takes over — a
 * restyle of text that is already in the right place, which is a far smaller
 * artefact than the blank screen it replaces. Per-conversation appearance isn't
 * in the warm cache (only `{messages, syncedAt}`), and widening that cache to
 * carry appearance is the follow-up if that swap ever reads as a flash.
 */
export function WarmThreadPreview({ fallback }: { fallback: ReactNode }) {
  const pathname = usePathname();
  const id = THREAD_PATH.exec(pathname ?? "")?.[1];
  const cached = id ? getCachedThread(id) : undefined;

  // Not warmed (cold start, a chat outside the top 10, a hard reload) — the
  // skeleton is still the honest answer there.
  if (!id || !cached || cached.messages.length === 0) return <>{fallback}</>;

  const convo = getEntry<Inbox>(INBOX_KEY).data?.conversations.find((c) => c.id === id);
  const title = convo?.title || convo?.other?.displayName || "";
  const avatarUrl = convo?.avatarUrl || convo?.other?.avatarUrl || null;

  // Oldest-first, and only the tail: the thread opens at the bottom, so the last
  // screenful is the only part anyone sees before the real room takes over.
  const messages = cached.messages.slice(-14);

  return (
    // Geometry copied from loading.tsx's skeleton, which already matches
    // [id]/page.tsx's mobile full-viewport overlay — the shell must not move
    // when the real page replaces this.
    <div className="fixed inset-0 z-50 flex min-h-0 flex-col bg-background lg:static lg:inset-auto lg:z-auto lg:flex-1 lg:bg-transparent">
      <span role="status" aria-live="polite" className="sr-only">
        Opening conversation
      </span>

      <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-sm font-bold">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- mirrors the real header; next/image would re-request at a different URL and defeat the point
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            (title || "?").charAt(0).toUpperCase()
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{title}</span>
        </span>
      </div>

      {/* justify-end: the thread opens at the newest message, so the tail sits
          at the bottom exactly as the real room's scroll-to-bottom leaves it. */}
      <div className="flex flex-1 flex-col justify-end gap-1.5 overflow-hidden p-4" aria-hidden>
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
            <span
              className={cn(
                "frenz-message-bubble max-w-[78%] whitespace-pre-wrap break-words rounded-3xl px-3.5 py-2 text-[15px] leading-relaxed",
                m.mine ? "bg-brand text-white" : "bg-secondary text-foreground",
              )}
            >
              {/* Attachment-only messages have an empty body — a bare bubble
                  would read as a broken message, so show nothing at all rather
                  than an empty pill. The real room paints the media a moment
                  later. */}
              {m.body || " "}
            </span>
          </div>
        ))}
      </div>

      <div className="border-t border-border/60 p-3">
        <div className="h-11 w-full rounded-2xl bg-secondary/60" />
      </div>
    </div>
  );
}
