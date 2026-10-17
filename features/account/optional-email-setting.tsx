"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The global switch for OPTIONAL email (Frenzsave Part 11, 0253 — lib/email/consent.ts).
 *
 * Saved tap by tap, and the switch only says "Saved" once the server has it; a failed save puts it
 * back and says so. Per-creator email choices are untouched: this sits above them — off silences
 * every optional email; on lets each creator choice decide again.
 */
export function OptionalEmailSetting({ initial }: { initial: { on: boolean; ready: boolean } }) {
  const [on, setOn] = useState(initial.on);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const toggle = async () => {
    if (state === "saving" || !initial.ready) return;
    const next = !on;
    setOn(next);
    setState("saving");
    setMessage(null);
    const res = await fetch("/api/notification-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ optionalEmail: next }) }).catch(() => null);
    if (res?.ok) {
      setState("saved");
      return;
    }
    setOn(!next);
    setState("error");
    const j = (await res?.json().catch(() => null)) as { error?: string } | null;
    setMessage(j?.error ?? "Couldn't save. Try again.");
  };

  return (
    <section aria-labelledby="optional-email-title" className="ex-card mb-4 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="optional-email-title" className="text-[15px] font-semibold">
            Optional emails
          </h2>
          <p id="optional-email-desc" className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            Creator announcements and new-post alerts, new-subscriber and new-member notices, renewal reminders and ad-slot alerts. When this is on, each creator&apos;s own email setting still decides.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="optional-email-title"
          aria-describedby="optional-email-desc"
          aria-busy={state === "saving"}
          disabled={!initial.ready}
          onClick={() => void toggle()}
          className="ex-switch mt-0.5"
        />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        Always sent, whatever you choose: sign-in codes, receipts, withdrawal and payout updates, credits you receive, and replies from support.
      </p>
      <p aria-live="polite" className={cn("mt-1 min-h-[1.1rem] text-[12.5px] font-medium", state === "error" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
        {!initial.ready ? "This switch arrives with the next update." : state === "saving" ? "Saving…" : state === "saved" ? (on ? "Saved. Optional emails are on." : "Saved. Optional emails are off.") : state === "error" ? message : ""}
      </p>
    </section>
  );
}
