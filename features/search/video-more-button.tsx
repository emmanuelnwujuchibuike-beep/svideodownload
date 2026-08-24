"use client";

import { MoreHorizontal } from "lucide-react";

import { toast } from "@/features/ui/toast";

/**
 * The "…" on a Popular-videos card.
 *
 * ── It does ONE real thing ────────────────────────────────────────────────
 * A dropdown menu here would mean a portal, an outside-click listener and a
 * focus trap mounted once per card — a global listener per tile on a page whose
 * whole brief is "no unnecessary global listeners". Every action such a menu
 * would plausibly hold (report, not-interested, add to collection) already
 * lives on the post's own page, one tap away through the card itself.
 *
 * So this is a share control wearing the affordance the reference shows: the
 * native share sheet where the OS provides one (every phone), a clipboard copy
 * with a toast where it doesn't (desktop). No import beyond the toast, no
 * listener, no state.
 */
export function VideoMoreButton({ href, title }: { href: string; title: string }) {
  const share = async () => {
    const url = new URL(href, window.location.origin).toString();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // AbortError = the user dismissed the sheet. Falling through to a
        // clipboard copy would be the app talking back after being dismissed,
        // so a cancelled share ends here.
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied", "success");
    } catch {
      toast("Couldn't copy that link", "error");
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      aria-label={`Share ${title}`}
      className="srch-press -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
    >
      <MoreHorizontal className="h-[18px] w-[18px]" aria-hidden />
    </button>
  );
}
