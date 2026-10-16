"use client";

import { Printer } from "lucide-react";

import { quietPill } from "@/features/friends/ui";
import { cn } from "@/lib/utils";

/** Print / save as PDF — the browser's own dialog; the receipt itself is rendered on the server. */
export function PrintButton({ className }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={cn(quietPill, className)}>
      <Printer className="h-4 w-4" aria-hidden /> Print or save as PDF
    </button>
  );
}
