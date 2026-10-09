"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentProps } from "react";

/**
 * A link that goes ONCE (owner, 2026-10-07: "when I click on the earn button
 * it delays and clicks twice, opening a second quest page instead of the home
 * page").
 *
 * A route behind the signed-in shell needs one server round trip on its first
 * open; a member who sees nothing happen taps again, and two navigations push
 * the same page twice — so back lands on the copy instead of where they came
 * from. This link:
 *   · starts fetching the route on touch / pointer DOWN (a head start of the
 *     press itself — no viewport prefetch, which would bill a render per view);
 *   · ignores every further tap until the route changes (or 4 s pass, in case
 *     the navigation never happened);
 *   · marks itself pressed (`data-pending`) AND shows a small spinner the
 *     instant it is tapped (owner, 2026-10-07: "the Earn and credits buttons
 *     don't respond on tap — they respond after some time"): the page may take
 *     a moment to arrive, but the button never looks dead while it does.
 * Scoped to the links that use it — nothing global, nothing that patches history.
 */
export function TapOnceLink({
  href,
  onClick,
  className,
  children,
  spinner = true,
  warmOnIdle = false,
  ...rest
}: ComponentProps<typeof Link> & {
  href: string;
  /** false for an icon-only circle: the spinner would push the icon off-centre, so its `data-pending` style shows the press instead. */
  spinner?: boolean;
  /**
   * Also fetch the route once the page is idle (2026-10-09, owner: the AI History button
   * "doesn't respond on first tap"). For one important door per page only - each warm is
   * one server render.
   */
  warmOnIdle?: boolean;
}) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const warm = () => {
    try {
      router.prefetch(href);
    } catch {
      /* prefetch is a hint */
    }
  };

  useEffect(() => {
    if (!warmOnIdle) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warm, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(warm, 2000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per door
  }, [warmOnIdle, href]);

  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      data-pending={busy ? "" : undefined}
      aria-busy={busy || undefined}
      className={className}
      onPointerDown={warm}
      onTouchStart={warm}
      onClick={(e) => {
        if (pending.current) {
          e.preventDefault();
          return;
        }
        // something earlier already cancelled this tap (the guest sign-in gate on a
        // data-ai-members door): nothing is navigating, so nothing is pending
        if (e.defaultPrevented) {
          onClick?.(e);
          return;
        }
        pending.current = true;
        setBusy(true);
        timer.current = window.setTimeout(() => {
          pending.current = false;
          setBusy(false);
        }, 4000);
        onClick?.(e);
      }}
    >
      {children}
      {busy && spinner ? <span aria-hidden className="ml-1 inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : null}
    </Link>
  );
}
