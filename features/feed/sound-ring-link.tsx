"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

/** How long a reel must be the one on screen before its sound is warmed — a swipe past never asks. */
const WARM_AFTER_MS = 700;

/**
 * The reel's spinning sound ring as a link that opens INSTANTLY (owner, 2026-10-30: "the sound button is supposed to
 * warm and prefetch so it opens instantly on click").
 *
 *   · a reel that carries a sound: a prefetching <Link> to its page from the first paint — Next.js fetches the page
 *     while the ring is on screen, so the tap shows it at once;
 *   · a reel without one yet (before 0308, or one whose sound wasn't made at publish): once it has been the ACTIVE
 *     reel for a moment, its original sound is made (POST /api/sounds/from-post/[id], lib/social/original-sound.ts) and
 *     the ring becomes that prefetching link. Reels scrolled past never ask, so nothing is made for them;
 *   · until then — or for a post whose audio can't be a sound — the ring is a plain link to the same route's redirect,
 *     which lands on the sound page or the creator's profile, as before.
 */
export function SoundRingLink({ postId, soundId, active, label, children }: { postId: string; soundId: string | null; active: boolean; label: string; children: ReactNode }) {
  const [warmed, setWarmed] = useState<string | null>(null);
  const href = soundId ? `/sound/${soundId}` : warmed ? `/sound/${warmed}` : null;

  useEffect(() => {
    if (soundId || warmed || !active) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      fetch(`/api/sounds/from-post/${postId}`, { method: "POST" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { soundId?: string | null } | null) => {
          if (!cancelled && j?.soundId) setWarmed(j.soundId);
        })
        .catch(() => {});
    }, WARM_AFTER_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [postId, soundId, warmed, active]);

  if (href) {
    return (
      <Link href={href} prefetch aria-label={label} className="block">
        {children}
      </Link>
    );
  }
  return (
    <a href={`/api/sounds/from-post/${postId}`} aria-label={label} className="block">
      {children}
    </a>
  );
}
