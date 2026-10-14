"use client";

import { Crown, Stamp } from "lucide-react";
import { useState } from "react";

import { useEntitlements } from "@/features/auth/use-entitlements";
import { MediaActionSheet, SheetGroup, SheetRow } from "@/features/feed/media-action-sheet";

export type DownloadVersion = "watermark" | "clean";

/**
 * "With or without the watermark?" — asked on every feed / Reels / post
 * download (owner, 2026-10-14: "Let users know when they're downloading to
 * choose with watermark or without watermarks. If they are in free they see a
 * upgrade to pro to use watermark free").
 *
 * Free members see the clean option as "Upgrade to Pro", which opens pricing.
 * The post's creator and Pro-and-up members can take either. The server
 * enforces the same rule (/api/posts/:id/download), so this is the
 * explanation, not the lock.
 */
export function DownloadChoiceSheet({ isOwner, onDone }: { isOwner: boolean; onDone: (v: DownloadVersion | null) => void }) {
  const { isPremium, ready } = useEntitlements();
  const [open, setOpen] = useState(true);
  // still loading → let them pick; the server answers for the plan
  const mayGoClean = isOwner || isPremium || !ready;
  const finish = (v: DownloadVersion | null) => {
    setOpen(false);
    onDone(v);
  };

  return (
    <MediaActionSheet open={open} onClose={() => finish(null)} label="Download options">
      <p className="px-2 pt-1 text-center text-[13px] font-medium text-muted-foreground">Save this post</p>
      <SheetGroup>
        <SheetRow icon={Stamp} label="With watermark" value="Free" onClick={() => finish("watermark")} />
        <SheetRow
          icon={Crown}
          label="Without watermark"
          value={mayGoClean ? "Pro" : "Upgrade to Pro"}
          onClick={() => {
            if (mayGoClean) {
              finish("clean");
              return;
            }
            finish(null);
            window.location.href = "/pricing";
          }}
        />
      </SheetGroup>
      {mayGoClean ? null : (
        <p className="px-3 pb-1 text-center text-[12px] text-muted-foreground">
          Free downloads carry the creator&apos;s @handle and the Frenzsave mark. Pro saves the original.
        </p>
      )}
    </MediaActionSheet>
  );
}
