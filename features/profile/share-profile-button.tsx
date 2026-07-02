"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";

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
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={share}
      aria-label="Share profile"
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:bg-secondary hover:text-foreground"
    >
      {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Share2 className="h-4 w-4" />}
    </button>
  );
}
