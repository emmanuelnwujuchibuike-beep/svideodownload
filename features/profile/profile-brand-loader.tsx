"use client";

import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";

/**
 * Premium branded loader for the profile route. It only appears if the page is
 * taking a while (after `delayMs`) — a fast load shows just the skeleton and
 * never flashes this. A pulsing Frenz "F" inside a spinning gradient ring.
 */
export function ProfileBrandLoader({ delayMs = 350 }: { delayMs?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background/75 backdrop-blur-md" aria-hidden>
      <span className="relative flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-[3px] border-violet-500/20 border-t-violet-500 [animation-duration:0.8s]" />
        <span className="absolute inset-1.5 animate-spin rounded-full border-[2px] border-blue-500/10 border-b-blue-500 [animation-duration:1.2s] [animation-direction:reverse]" />
        <span className="animate-pulse drop-shadow-[0_2px_12px_rgba(124,58,237,0.45)]">
          <FrenzLogo size={44} />
        </span>
      </span>
      <span className="text-gradient text-sm font-bold tracking-tight">Loading profile…</span>
    </div>
  );
}
