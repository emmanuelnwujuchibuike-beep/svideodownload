"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * "Make the AI balance hide when tapped" (owner, 2026-09-20). One tap on the
 * figure masks it — on the balance page and on the workspace's balance card
 * alike — and the choice is kept per browser so a member who hides it
 * before a screen share does not find it back on the next page.
 *
 * A per-viewer convenience: localStorage, wrapped (a private window or a
 * sandboxed preview can refuse it), never sent anywhere, and the figure is
 * drawn VISIBLE until the stored choice is read so the server and the first
 * client paint agree.
 */
const KEY = "frenz-ai:balance-hidden";
const EVENT = "frenz-ai:balance-hidden";

export const HIDDEN_AMOUNT = "••••••";

function read(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useBalanceHidden(): [hidden: boolean, toggle: () => void] {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(read());
    const sync = () => setHidden(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const toggle = useCallback(() => {
    const next = !read();
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* no storage: the toggle still works for this page */
    }
    setHidden(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [hidden, toggle];
}
