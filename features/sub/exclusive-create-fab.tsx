"use client";

import { Plus } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { forgetSubPosts } from "@/features/sub/sub-posts-cache";
import { haptic } from "@/lib/motion/haptics";

const loadComposer = () => import("@/features/sub/sub-composer");
const SubComposer = dynamic(() => loadComposer().then((m) => m.SubComposer), { ssr: false });

export interface ExclusiveCreateFabProps {
  /** compose = the member has set up Exclusive (the composer opens here); setup = they haven't (their setup opens). */
  mode: "compose" | "setup";
  viewerId: string;
  /** Their profile's Exclusive tab, where setup lives. */
  setupHref: string;
}

/**
 * The Exclusive feed's floating "+" (owner, 2026-10-31: "a glass ring floating plus button at the right corner of the
 * exclusive feed page, so users can make their own posts — users who have set up the exclusive post get directed
 * straight to the make an exclusive post, while users who haven't set it up, landing on the exclusive set up").
 *
 * Mounted by ExclusiveFabSlot only after the page has loaded. Once on screen it WARMS the next step so the tap answers
 * at once: a set-up creator's composer chunk is fetched, or the setup page is prefetched.
 */
export function ExclusiveCreateFab({ mode, viewerId, setupHref }: ExclusiveCreateFabProps) {
  const router = useRouter();
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    if (mode === "compose") void loadComposer().catch(() => undefined);
    else router.prefetch(setupHref);
  }, [mode, setupHref, router]);

  // exactly the reference's round glass button (.fme.fglass + .fme-photo): globals.css .frenz-orb — the bottom nav's
  // liquid glass, 66 px with 5 px padding, a dark disc with the violet ring inside, and its spring press (scale .92)
  const ring = "frenz-orb frenz-nav-glass fixed left-4 z-40 flex h-[66px] w-[66px] rounded-full p-[5px] lg:hidden";
  const face = "frenz-orb-face flex flex-1 items-center justify-center rounded-full text-white";
  const style = { bottom: "calc(var(--frenz-nav-clearance, 5.5rem) + 0.75rem)" };
  const icon = <Plus className="h-[26px] w-[26px]" strokeWidth={2.6} aria-hidden />;

  return (
    <>
      {mode === "compose" ? (
        <button
          type="button"
          aria-label="New exclusive post"
          onClick={() => {
            haptic("light");
            setComposing(true);
          }}
          className={ring}
          style={style}
        >
          <span className={face}>{icon}</span>
        </button>
      ) : (
        <Link href={setupHref} aria-label="Set up Exclusive" onClick={() => haptic("light")} className={ring} style={style}>
          <span className={face}>{icon}</span>
        </Link>
      )}
      {composing ? (
        <SubComposer
          onClose={() => setComposing(false)}
          onPosted={() => {
            forgetSubPosts(viewerId);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
