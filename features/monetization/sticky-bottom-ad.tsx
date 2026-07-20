"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { useShowAds } from "./use-show-ads";

/**
 * The fixed bottom banner — the site's one persistent placement.
 *
 * ── The SofaScore treatment ───────────────────────────────────────────────────
 *
 * A solid card pinned to the bottom of the viewport, with a hairline top border
 * and the page's own shadow language, on EVERY page rather than only the home
 * page. It has no dismiss control: it is chrome, like a tab bar, and an X on it
 * invites the reading that it is an interruption to be got rid of. That was the
 * explicit brief, and `isPersistentZone` enforces it inside `AdSlot`, so it
 * cannot be re-enabled by a caller passing `dismissible`.
 *
 * ── Why an opaque bar and not a floating banner ───────────────────────────────
 *
 * Over a scrolling page a transparent banner reads as an overlay stuck to the
 * screen. On an opaque bar it reads as the bottom of the application. The bar
 * only exists when there is an ad in it, so the page is never shortened for
 * nothing — the previous version reserved a floating area whether or not
 * anything filled it.
 *
 * ── Two zones, and why ────────────────────────────────────────────────────────
 *
 * `bottom_banner` is the current placement and serves every device.
 * `mobile_bottom_banner` is the one it replaces. Rather than orphan a row an
 * operator already configured, this falls back to the legacy zone when the new
 * one is empty — and the fallback stays mobile-only, exactly as that zone always
 * was, so an old row cannot suddenly put a 320×50 unit on a desktop layout.
 *
 * ── Layout ────────────────────────────────────────────────────────────────────
 *
 * z-20: above content, below the chat widget (z-30) and the mobile menu (z-40+),
 * so it can never trap a tap. A spacer of the bar's height is appended to the
 * document so the footer's last row stays reachable — a fixed bar otherwise
 * covers exactly the strip the legal links sit in.
 */
export function StickyBottomAd() {
  const { showAds, ready } = useShowAds();
  const [hasPrimary, setHasPrimary] = useState<boolean | null>(null);
  const [hasLegacy, setHasLegacy] = useState<boolean | null>(null);

  if (!ready || !showAds) return null;

  /*
    The legacy zone is only asked once the current one has answered "nothing".
    Firing both on every page load would double the request count for a fallback
    that most sites will never use.
  */
  const askLegacy = hasPrimary === false;
  const visible = hasPrimary === true || hasLegacy === true;

  return (
    <>
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-20 border-t border-border/60 bg-card/95 pt-2 backdrop-blur-sm",
          "pb-[max(0.5rem,env(safe-area-inset-bottom))]",
          !visible && "hidden",
        )}
        aria-hidden={!visible}
      >
        <div className="mx-auto flex w-full max-w-5xl items-center justify-center px-3">
          <div className={cn(hasPrimary !== true && "hidden")}>
            <AdSlot zone="bottom_banner" dismissible={false} onResolved={setHasPrimary} />
          </div>

          {askLegacy ? (
            <div className={cn("md:hidden", hasLegacy !== true && "hidden")}>
              <AdSlot zone="mobile_bottom_banner" dismissible={false} onResolved={setHasLegacy} />
            </div>
          ) : null}
        </div>
      </div>

      {visible ? <div aria-hidden className="h-[76px]" /> : null}
    </>
  );
}
