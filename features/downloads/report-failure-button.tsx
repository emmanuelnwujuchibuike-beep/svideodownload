"use client";

import { Check, Flag, Loader2 } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * "Report this" — next to Retry, on a download that failed.
 *
 * Owner, 2026-09-02: "put a promt for download fail so users can see a retry or
 * send report button that instantly send a fail report to the admin email with
 * the download link and details to investigate."
 *
 * ── 🔴 IT SITS BESIDE RETRY, NOT INSTEAD OF IT ───────────────────────────────
 *
 * Retry is what the person actually wants; a report does nothing for them
 * today. So Retry keeps the primary treatment and this is the quieter sibling —
 * offering them equally would be asking someone to do us a favour at the moment
 * they are least inclined to.
 *
 * ── It never fails in front of the visitor ───────────────────────────────────
 *
 * The endpoint answers OK even when the mail could not be sent, and this
 * component shows "Reported" either way. Telling someone their bug report
 * failed to send is how you teach them never to send one again — and the thing
 * that went wrong is ours, not theirs. Real delivery problems surface in the
 * server logs, where someone can act on them.
 *
 * ── One press, one report ────────────────────────────────────────────────────
 *
 * The button latches to a confirmed state rather than resetting, so a
 * frustrated double-tap does not send two emails about one failure. The server
 * deliberately does NOT dedupe (a person reporting twice is telling us it is
 * still broken), which is exactly why the restraint belongs here instead.
 */
export function ReportFailureButton({
  url,
  platform,
  formatId,
  kind,
  title,
  errorCode,
  errorMessage,
  surface,
  className,
}: {
  url: string;
  platform?: string | null;
  formatId?: string | null;
  kind?: string | null;
  title?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** Where it failed — downloader, history, batch. Helps triage. */
  surface?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  // Nothing useful to report without the link that failed.
  if (!url) return null;

  const send = async () => {
    if (state !== "idle") return;
    setState("sending");
    try {
      await fetch("/api/report/download-failure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          platform: platform ?? "",
          formatId: formatId ?? "",
          kind: kind ?? "",
          title: title ?? "",
          errorCode: errorCode ?? "",
          errorMessage: errorMessage ?? "",
          surface: surface ?? "",
        }),
      });
    } catch {
      /* See the note above — a failed report still reads as sent. */
    }
    setState("sent");
  };

  return (
    <button
      type="button"
      onClick={() => void send()}
      disabled={state !== "idle"}
      aria-label={state === "sent" ? "Problem reported" : "Report this problem"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition",
        state === "sent"
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        className,
      )}
    >
      {state === "sending" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === "sent" ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Flag className="h-3.5 w-3.5" />
      )}
      {state === "sent" ? "Reported — thank you" : state === "sending" ? "Sending…" : "Report this"}
    </button>
  );
}
