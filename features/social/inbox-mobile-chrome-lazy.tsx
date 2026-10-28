"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * The shell's door to `InboxMobileChrome` (2026-10-27, "the Download page now loads like I'm downloading a file").
 *
 * The chrome renders only on /messages, but importing it statically from the (app) layout put its whole tree —
 * framer-motion (compose + group sheets), the presence picker and with it the eager Supabase browser client — into
 * the first load of EVERY signed-in route, /downloads included. This wrapper is all the layout ships now: a pathname
 * check. The chrome arrives as its own chunk on /messages, and is warmed at idle elsewhere so the first visit to the
 * inbox paints it straight away. It still mounts in the persistent shell, so the swipe-back fix it exists for holds.
 */
const load = () => import("@/features/social/inbox-mobile-chrome");
// SSR kept: on /messages the server renders it and Next ships its chunk with the page, so a cold inbox has no gap
const InboxMobileChrome = dynamic(() => load().then((m) => m.InboxMobileChrome));

export function InboxMobileChromeLazy() {
  const pathname = usePathname();
  const inMessages = pathname === "/messages" || pathname.startsWith("/messages/");

  useEffect(() => {
    if (inMessages) return;
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2500));
    const id = ric(() => void load().catch(() => {}));
    return () => (window.cancelIdleCallback ?? window.clearTimeout)(id);
  }, [inMessages]);

  return inMessages ? <InboxMobileChrome /> : null;
}
