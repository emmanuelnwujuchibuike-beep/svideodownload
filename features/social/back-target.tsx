"use client";

import { useEffect } from "react";

import { setBackTarget } from "@/lib/dom/back-target";

/**
 * Declares where the swipe-back gesture should land while this page is on
 * screen. Renders nothing.
 *
 * Mounted by a page that knows its own history is not what the user expects —
 * today that is a chat opened through the `/messages/new/[id]` get-or-create
 * route, whose server redirect replaces the history entry and leaves no inbox
 * behind the thread. See lib/dom/back-target.ts.
 *
 * Clears on unmount, so the override cannot outlive the page that set it.
 */
export function BackTarget({ href }: { href: string }) {
  useEffect(() => {
    setBackTarget(href);
    return () => setBackTarget(null);
  }, [href]);
  return null;
}
