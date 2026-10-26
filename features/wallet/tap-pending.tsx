"use client";

import { useLinkStatus } from "next/link";
import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/*
  The owner's rule (2026-10-11, restated 2026-10-25: "buttons should answer tap instant on all features — tap and the
  button spins till it opens"). A wallet link's next screen is server-rendered, so it cannot appear on the tap; the
  button must. Rendered INSIDE a <Link>: shows its normal content, and the instant the link is tapped (useLinkStatus
  pending) swaps in a spinner until the next screen opens. No delay — the spin IS the answer to the tap.
*/

/** A small ring spinner in the current text colour. Reduced motion: it still shows, just doesn't spin. */
export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Inside a <Link>: `children` normally; a spinner from the moment the link is tapped until the next page opens. */
export function TapPending({ children, size = 18, className }: { children: ReactNode; size?: number; className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return <>{children}</>;
  return (
    <>
      <Spinner size={size} className={className} />
      <span className="sr-only">Opening…</span>
    </>
  );
}

/**
 * Inside a <Link> that sits in a menu or sheet (profile menu, chat options): close it only once the tapped link has
 * finished opening — closing on the tap removed the button before its spinner could show (owner, 2026-10-25: "every
 * place that has the wallet should get the spinner, the chat option, the profile menu and all").
 */
export function CloseWhenOpened({ onOpened }: { onOpened?: () => void }) {
  const { pending } = useLinkStatus();
  const was = useRef(false);
  useEffect(() => {
    if (pending) was.current = true;
    else if (was.current) {
      was.current = false;
      onOpened?.();
    }
  }, [pending, onOpened]);
  return null;
}
