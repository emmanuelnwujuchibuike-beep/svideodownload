"use client";

import { UsersRound } from "lucide-react";
import { useState } from "react";

import { CreateGroupSheet } from "@/features/social/create-group-sheet";
import { cn } from "@/lib/utils";

/** "New group" entry point — icon button that opens CreateGroupSheet. */
export function CreateGroupLauncher({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="New group"
        title="New group"
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground",
          className,
        )}
      >
        <UsersRound className="h-[18px] w-[18px]" />
      </button>
      <CreateGroupSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
