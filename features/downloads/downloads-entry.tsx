"use client";

import { FolderDown } from "lucide-react";
import Link from "next/link";

import { IconTile } from "@/components/icons/icon-tile";
import { useUser } from "@/features/auth/use-user";

/**
 * The header "your downloads" entry — auth-aware and prefetched.
 *
 * Signed-out visitors go to `/library` (the public, static download page);
 * signed-in visitors go to `/downloads` (the full dashboard). Previously the
 * only "Downloads" affordances pointed everyone at `/downloads`, which walled a
 * guest at the login screen the moment they looked for a file they'd just saved.
 *
 * `prefetch` on the Link warms the destination as soon as it's in the viewport
 * (the header always is), so the first tap opens with no loading — the brief's
 * "prefetch immediately so it doesn't load at all" — without the extra
 * `useRouter` a manual prefetch would have cost every page's bundle.
 */
export function DownloadsEntry({ variant = "icon" }: { variant?: "icon" | "tile" }) {
  const { user } = useUser();
  const href = user ? "/downloads" : "/library";

  if (variant === "tile") {
    return (
      <Link href={href} prefetch aria-label="Your downloads" title="Your downloads" className="inline-flex h-10 w-10 items-center justify-center">
        <IconTile>
          <FolderDown className="h-5 w-5" />
        </IconTile>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      prefetch
      aria-label="Your downloads"
      title="Your downloads"
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <FolderDown className="h-5 w-5" />
    </Link>
  );
}
