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
 *   · marks itself pressed (`data-pending`), so the member sees the tap landed.
 * Scoped to the links that use it — nothing global, nothing that patches history.
 */
export function TapOnceLink({ href, onClick, className, children, ...rest }: ComponentProps<typeof Link> & { href: string }) {
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

  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      data-pending={busy ? "" : undefined}
      aria-busy={busy || undefined}
      className={className}
      onPointerDown={warm}
      onClick={(e) => {
        if (pending.current) {
          e.preventDefault();
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
    </Link>
  );
}
