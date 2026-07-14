"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { MessageSearchSheet } from "@/features/social/message-search-sheet";

/**
 * "Search messages" entry point (Part 10) — a row inside the inbox header's
 * "…" dropdown (see inbox-header-actions.tsx); opens MessageSearchSheet.
 * `onNavigate` fires the instant the sheet opens, so the caller can close its
 * own dropdown rather than leaving it stacked behind the full-screen sheet.
 */
export function MessageSearchLauncher({ onNavigate }: { onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setOpen(true);
          onNavigate?.();
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition hover:bg-secondary"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary/80 text-muted-foreground">
          <Search className="h-4 w-4" />
        </span>
        Search messages
      </button>
      <MessageSearchSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
