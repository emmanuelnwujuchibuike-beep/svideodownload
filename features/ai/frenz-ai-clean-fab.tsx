"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { useScrollDirection } from "@/lib/dom/use-scroll-direction";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "CLEAN A VIDEO" — the action, kept within reach of the thumb
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "make the clean your videos be a floating premium widget
 * at the bottom right side of the history page that stick when scrolling up and
 * hide when scrolling down, and it shouldn't break any performance or cause
 * overheating."
 *
 * ── Why this earns its place ────────────────────────────────────────────────
 *
 * Moving history up the page solved one problem and created another: the
 * primary action scrolls away the moment somebody starts reading their past
 * work. A list you scroll and an action you take are different jobs, and only
 * one of them should have to stay on screen. So the action floats and the page
 * belongs to the history.
 *
 * ── 🔴 THE PERFORMANCE RULE IS AN INSTRUCTION, NOT A PREFERENCE ─────────────
 *
 * "it shouldn't break any performance or cause overheating", and this feature
 * has made the app unresponsive twice already. What that costs here:
 *
 *   · NO scroll listener of its own. `useScrollDirection` is a module-level
 *     store behind `useSyncExternalStore` — ONE passive listener for the whole
 *     app, coalesced into a single rAF, reading nothing but `scrollY`. A second
 *     handler here is exactly how a page starts dropping frames on a low-end
 *     phone, and it would also let this widget disagree with the bottom nav
 *     about which way the page is going;
 *   · the show/hide is `transform` + `opacity` ONLY. Both are composited, so
 *     the main thread never sees a frame of it. No width, no height, no
 *     `top`, nothing that triggers layout;
 *   · no `backdrop-blur` (removed site-wide on 2026-09-08 after 25 of them made
 *     the app unresponsive), no filter, no shadow animation, and nothing that
 *     runs when the widget is still;
 *   · it renders the same two nodes whether shown or hidden — hiding is a
 *     class change, not a mount, so there is no work at the moment of hiding.
 *
 * ── It cannot become a trap ─────────────────────────────────────────────────
 *
 * `pointer-events-none` while hidden, so a widget that has slid off screen can
 * never swallow a tap meant for the row underneath it. And it is
 * `aria-hidden` in that state for the same reason in the other modality.
 */
export function FrenzAICleanFab({
  href = "/studio/ai/clean",
  className,
}: {
  href?: string;
  className?: string;
}) {
  /*
    "up" is also the server snapshot and the value at the top of a page, so the
    first paint has the widget VISIBLE — matching the SSR markup exactly, which
    is what keeps this out of hydration-mismatch territory.
  */
  const hidden = useScrollDirection() === "down";

  return (
    <div
      className={cn(
        /*
          🔴 `fixed`, and therefore portal-free ONLY because nothing on this
          page is a blurred or transformed ancestor. This project has a standing
          law that a `fixed` overlay inside transformed chrome must be
          portalled — it was hit three times in one day. The AI page's wrapper
          sets CSS variables and a border radius, neither of which creates a
          containing block, so `fixed` resolves against the viewport here.
        */
        "fixed right-4 z-40 sm:right-6",
        /*
          Above the bottom nav AND above the phone's home indicator. The nav is
          ~64px; `env(safe-area-inset-bottom)` is what stops this sitting under
          the gesture bar on an iPhone, which is the classic way a FAB becomes
          untappable on exactly the devices that matter most here.
        */
        "bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] sm:bottom-6",
        "transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none",
        hidden
          ? "pointer-events-none translate-y-[140%] opacity-0"
          : "pointer-events-auto translate-y-0 opacity-100",
        className,
      )}
      aria-hidden={hidden}
    >
      <Link
        href={href}
        prefetch={false}
        tabIndex={hidden ? -1 : undefined}
        className={cn(
          "group inline-flex items-center gap-2.5 rounded-full py-3.5 pl-4 pr-5",
          /*
            The premium treatment, painted ONCE: a brand gradient and a single
            coloured drop shadow. Both are static — the only thing that moves on
            this widget is the show/hide transform above.
          */
          "bg-gradient-to-r from-blue-600 via-indigo-500 to-fuchsia-500 text-white",
          "shadow-[0_14px_34px_-10px_rgb(79_70_229/0.75)]",
          "ring-1 ring-inset ring-white/20",
          "transition-transform duration-200 active:scale-[0.97] motion-safe:hover:-translate-y-0.5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2",
        )}
      >
        <FrenzLogo size={20} alt="" />
        <span className="text-[13.5px] font-bold tracking-[-0.01em]">Clean a video</span>
        <ArrowRight
          className="h-4 w-4 transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </div>
  );
}
