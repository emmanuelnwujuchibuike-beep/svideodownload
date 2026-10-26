"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";

import { afterPageLoad } from "@/features/app-shell/warm-routes";

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
  stripe = false,
  ...rest
}: ComponentProps<typeof Link> & {
  /**
   * Show the loading stripe across the top of the screen from the tap until the next page takes
   * over (owner, 2026-10-22: "the stripe loader should assist when there's a bad network"). For a
   * door whose page is not yet prefetched on a slow connection, the stripe is the proof the tap
   * landed. It outlives the 4 s re-tap guard (a bad network can take longer) and gives up at 15 s.
   */
  stripe?: boolean;
  href: string;
  /** false for an icon-only circle: the spinner would push the icon off-centre, so its `data-pending` style shows the press instead. */
  spinner?: boolean;
  /**
   * Also fetch the route once the page has loaded and is idle (2026-10-09, owner: the AI History button
   * "doesn't respond on first tap"). For one important door per page only - each warm is
   * one server render.
   */
  warmOnIdle?: boolean;
}) {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => setLoading(false), 15_000);
    return () => window.clearTimeout(t);
  }, [loading]);

  const warm = () => {
    try {
      router.prefetch(href);
    } catch {
      /* prefetch is a hint */
    }
  };

  /*
    🔴 Only after the page's `load` event (2026-10-26, owner: "the download page and landing page are taking time
    to load"). A bare requestIdleCallback fires in the gaps WHILE the page is still loading: measured cold on the
    landing (Pixel 7, 4x CPU, 1.6 Mbps), /quests, /exclusive and /advertise/campaigns each pulled their route
    payload and a dozen JS chunks from 10 s, holding the load event to 17.7 s and parsing other pages' code on
    the main thread. The tap itself still warms on pointer-down, so nothing loses its head start.
  */
  useEffect(() => {
    if (!warmOnIdle) return;
    return afterPageLoad(warm);
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
        // a new-tab / modified click navigates nothing here, so it shows no stripe
        if (stripe && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) setLoading(true);
        timer.current = window.setTimeout(() => {
          pending.current = false;
          setBusy(false);
        }, 4000);
        onClick?.(e);
      }}
    >
      {children}
      {busy && spinner ? <span aria-hidden className="ml-1 inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : null}
      {loading && typeof document !== "undefined"
        ? createPortal(
            <div className="pointer-events-none fixed inset-x-0 top-0 z-[100]" style={{ paddingTop: "var(--frenz-safe-top, 0px)" }}>
              {/* page-loader.tsx's LoadingStripe, drawn here so this link (on the landing) never pulls that module in */}
              <div role="status" aria-label="Loading" className="w-full overflow-hidden bg-primary/10" style={{ height: "2px" }}>
                <div className="frenz-loader-bar h-full w-2/5 bg-gradient-to-r from-blue-500 via-violet-500 to-fuchsia-500" />
              </div>
            </div>,
            document.body,
          )
        : null}
    </Link>
  );
}
