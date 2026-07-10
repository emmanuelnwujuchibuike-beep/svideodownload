"use client";

import { Flag } from "lucide-react";
import { useState } from "react";

import { ReportSheet } from "@/features/social/report-sheet";

/** Report a post/comment/user — opens the real Report sheet (category + note). */
export function ReportButton({
  targetType,
  targetId,
}: {
  targetType: "post" | "comment" | "user";
  targetId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        <Flag className="h-4 w-4" /> Report
      </button>
      <ReportSheet targetType={targetType} targetId={targetId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
