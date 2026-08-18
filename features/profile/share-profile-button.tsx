"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

import { toast } from "@/features/ui/toast";

/**
 * Share a profile: native share sheet where available (mobile), clipboard
 * copy with a ✓ confirmation elsewhere.
 */
export function ShareProfileButton({ handle, name }: { handle: string; name: string }) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = `${window.location.origin}/u/${handle}`;
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
