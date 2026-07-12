"use client";

import { UserPlus } from "lucide-react";
import { IoPersonAddOutline } from "react-icons/io5";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

/**
 * Add-friends entry point. Navigates to the full-page /friends/discover (search +
 * people you may know) instead of opening a load-on-open sheet — so it opens
 * instantly. Prefetches on hover/touch for a native, no-wait transition.
 *
 * `variant="icon"` (default) is the single top-nav icon (level with search / the
 * profile menu); `variant="pill"` is the older labelled button for legacy spots.
 */
export function SuggestionsLauncher({
  className,
  variant = "icon",
}: {
  className?: string;
  variant?: "icon" | "pill";
}) {
  const router = useRouter();
  const warm = () => router.prefetch("/friends/discover");
  const tap = () => {
    haptic("light");
    playSound("tap");
  };

  if (variant === "icon") {
    return (
      <Link
        href="/friends/discover"
        onPointerEnter={warm}
        onPointerDown={warm}
        onClick={tap}
        aria-label="Add friends"
        title="Add friends"
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full bg-secondary/50 text-foreground ring-1 ring-inset ring-border/50 transition hover:bg-secondary active:scale-95",
          className,
        )}
      >
        <IoPersonAddOutline className="h-[20px] w-[20px]" />
      </Link>
    );
  }

  return (
    <Link
      href="/friends/discover"
      onPointerEnter={warm}
      onPointerDown={warm}
      onClick={tap}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/70 px-3.5 py-2 text-sm font-semibold text-foreground shadow-soft backdrop-blur transition hover:border-primary/40 active:scale-95",
        className,
      )}
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white">
        <UserPlus className="h-3 w-3" />
      </span>
      Add friends
    </Link>
  );
}
