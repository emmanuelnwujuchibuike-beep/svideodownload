"use client";

import { Copy } from "lucide-react";
import { useState } from "react";

import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { ProfileQr } from "@/features/profile/profile-qr";
import { toast } from "@/features/ui/toast";

/**
 * QR Code destination (Part 6) — reuses `ProfileQr` (a pure, server-safe
 * component: `encodeQr`/`matrixPath` are plain math + `TextEncoder`, no
 * Node-only APIs, so it renders fine inside this client sheet too) rather
 * than building a second QR renderer. Generated locally, same as the
 * profile card's — no third-party QR service ever sees a shared link.
 */
export function ShareQrSheet({
  postId,
  url,
  open,
  onClose,
}: {
  postId: string;
  url: string;
  open: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Best-effort share-counter bump — see share-sheet.tsx's bumpShareCounter
  // for why every share ACTION does this, not just the DM-send path.
  const bumpShareCounter = () => {
    fetch(`/api/posts/${postId}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "share", kind: "qr" }),
    }).catch(() => {});
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      bumpShareCounter();
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast("Couldn't copy the link.", "error");
    }
  };

  return (
    <GlassSheetShell open={open} onClose={onClose} title="QR code" defaultHeightVh={56}>
      <div className="flex flex-col items-center gap-4 py-4">
        <div className="rounded-3xl border border-border/60 bg-white p-4 shadow-soft">
          <ProfileQr value={url} label="Scan to open this post" size={220} />
        </div>
        <p className="text-center text-sm text-muted-foreground">Scan with any camera to open this post.</p>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 rounded-2xl border border-border/60 bg-secondary/40 px-4 py-2.5 text-sm font-semibold text-foreground transition hover:bg-secondary"
        >
          <Copy className="h-4 w-4" /> {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
    </GlassSheetShell>
  );
}
