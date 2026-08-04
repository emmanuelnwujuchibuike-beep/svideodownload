"use client";

import { Check, Copy, Download, Share2 } from "lucide-react";
import { useCallback, useState } from "react";

/**
 * One-tap sharing for the Digital Business Card (Part 18).
 *
 * ── Why the native sheet is called synchronously ─────────────────────────
 * `navigator.share` requires transient activation: it must be invoked in the
 * same task as the tap. Doing any `await` first — even a cheap one — spends
 * the activation and iOS silently refuses. That exact bug cost this codebase a
 * round of "the share button does nothing on iPhone", so the share data is
 * assembled up front and the call is the first thing that happens.
 *
 * Copy is the fallback rather than the primary, because a native sheet reaches
 * WhatsApp, Messages and AirDrop, which is where a card actually gets sent.
 */
export function CardShareActions({
  handle,
  displayName,
  url,
  vcardHref,
}: {
  handle: string;
  displayName: string;
  url: string;
  vcardHref: string;
}) {
  const [copied, setCopied] = useState(false);

  const share = useCallback(() => {
    const data = { title: displayName, text: `${displayName} (@${handle}) on Frenz`, url };
    // No await before this line — see the header.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      navigator.share(data).catch(() => {
        /* the user dismissed the sheet — not an error */
      });
      return;
    }
    void copy();
  }, [displayName, handle, url]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the URL is visible on the page either way */
    }
  }, [url]);

  return (
    <div className="mt-4 grid grid-cols-3 gap-2">
      <button type="button" onClick={share} className="lux-fab lux-press flex flex-col items-center gap-1 rounded-2xl px-2 py-3">
        <Share2 className="h-5 w-5" />
        <span className="text-[11px] font-semibold">Share</span>
      </button>

      <button
        type="button"
        onClick={() => void copy()}
        className="lux-press flex flex-col items-center gap-1 rounded-2xl bg-secondary px-2 py-3 ring-1 ring-inset ring-border transition hover:bg-secondary/70"
      >
        {copied ? <Check className="h-5 w-5 text-emerald-500" /> : <Copy className="h-5 w-5 text-[#2563FF]" />}
        <span className="text-[11px] font-semibold">{copied ? "Copied" : "Copy link"}</span>
      </button>

      {/* A real download, not a fetch-then-blob: the vCard route already sets
          Content-Disposition, so the browser saves it straight to Contacts on
          iOS and Android. */}
      <a
        href={vcardHref}
        download
        className="lux-press flex flex-col items-center gap-1 rounded-2xl bg-secondary px-2 py-3 text-center ring-1 ring-inset ring-border transition hover:bg-secondary/70"
      >
        <Download className="h-5 w-5 text-[#6D5CFF]" />
        <span className="text-[11px] font-semibold">Save contact</span>
      </a>
    </div>
  );
}
