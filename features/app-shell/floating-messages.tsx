"use client";

import { IoPaperPlane } from "react-icons/io5";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useQuery } from "@/features/data";
import { INBOX_KEY, loadInbox, type Inbox } from "@/features/social/inbox";

/**
 * Premium floating Messages button (desktop only). Replaces the "Chat" row in
 * the sidebar with a single, elegant floating pill — Instagram-style — with a
 * live unread badge. Hidden on mobile (the bottom-nav Inbox tab covers it) and
 * on the messages surface itself.
 */
export function FloatingMessages() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: inbox } = useQuery<Inbox>(INBOX_KEY, loadInbox);
  const unread = inbox?.unread ?? 0;

  // Don't float over the messages pages.
  if (pathname.startsWith("/messages")) return null;

  return (
    <Link
      href="/messages"
      onPointerDown={() => router.prefetch("/messages")}
      aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
      className="group fixed bottom-6 right-6 z-40 hidden items-center gap-2.5 rounded-full border border-white/15 bg-gradient-to-br from-blue-600 to-violet-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-violet-600/30 ring-1 ring-inset ring-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-600/45 lg:inline-flex"
    >
      <span className="relative flex items-center justify-center">
        <IoPaperPlane className="h-5 w-5 -rotate-12 transition-transform group-hover:rotate-0" />
        {unread > 0 ? (
          <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-violet-600">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </span>
      Messages
    </Link>
  );
}
