"use client";

import { Check, Share2 } from "lucide-react";
import { ShareUpIcon } from "@/features/frenz-ui/icons";
import { useState } from "react";

import { toast } from "@/features/ui/toast";
import { profilePath } from "@/lib/social/profile-url";

/**
 * Share a profile: native share sheet where available (mobile), clipboard
 * copy with a ✓ confirmation elsewhere.
 */
export function ShareProfileButton({
  handle,
  name,
  variant = "icon",
}: {
  handle: string;
  name: string;
  /** "button": the design's labelled "Share profile" button (design/Profile.dc.html, 2026-10-18). */
  variant?: "icon" | "button";
}) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = `${window.location.origin}${profilePath(handle)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${name} on Frenz`, url });
        return;
      }
    } catch {
      /* user cancelled the sheet — fall through to nothing */
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      // 🔴 A toast too, not just the icon swap (owner, 2026-08-18: "make
      // profile and post link... copied to show a link copied prompt") —
      // this button carries no visible text label (only an aria-label), so
      // the checkmark alone was easy to miss/ambiguous with "shared".
      toast("Link copied.", "success");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };

  if (variant === "button") {
    return (
      <button
        type="button"
        onClick={share}
        className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] border border-frenz-line bg-frenz-card text-[15px] font-bold text-frenz-ink transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <ShareUpIcon size={17} />}
        Share profile
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={share}
      aria-label="Share profile"
      className="btn-lux-icon"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Share2 className="h-4 w-4" />}
    </button>
  );
}
