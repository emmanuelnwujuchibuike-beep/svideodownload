"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { MessageSearchSheet } from "@/features/social/message-search-sheet";
import { cn } from "@/lib/utils";

/** "Search messages" entry point (Part 10) — icon button that opens MessageSearchSheet. */
export function MessageSearchLauncher({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search messages"
        title="Search messages"
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground",
          className,
        )}
      >
        <Search className="h-[18px] w-[18px]" />
      </button>
      <MessageSearchSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
