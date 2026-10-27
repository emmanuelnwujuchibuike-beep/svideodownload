"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { afterPageLoad } from "@/features/app-shell/warm-routes";
import { PendingLink } from "@/features/frenz-ui/pending";

const CREATE_STORY = "/create/story";

/**
 * "Add to your story" — the plus ring on Home, Messages and Friends (owner, 2026-10-27: "every server side rendered
 * button in the story prefetches and uses the button spinner when server is low").
 *
 *   · prefetch: the composer is warmed once the page has LOADED (afterPageLoad — these rings sit on cold-entry pages,
 *     where a prefetch during load slows the page itself), and again the moment a finger lands;
 *   · spinner: a real link with the shared spinner (useLinkStatus), from the tap until the composer opens.
 *
 * `className` is the ring's own layout; it is passed to the link AND to its inner wrapper so nothing moves.
 */
export function AddStoryLink({ className, label, children }: { className: string; label?: string; children: ReactNode }) {
  const router = useRouter();
  useEffect(() => afterPageLoad(() => router.prefetch(CREATE_STORY)), [router]);
  return (
    <PendingLink href={CREATE_STORY} prefetch={false} onPointerDown={() => router.prefetch(CREATE_STORY)} aria-label={label} className={className} inner={className}>
      {children}
    </PendingLink>
  );
}
