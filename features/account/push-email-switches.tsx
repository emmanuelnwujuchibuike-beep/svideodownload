"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * One notification event's two switches — push and email — each saved on its own through PATCH
 * /api/notification-settings and only shown as saved once the server has it (a failed save puts the switch back and
 * says so). Turning one off never changes the other. Used by sticker gifts (0294) and message requests (0295); the
 * global switches on the same page (notifications, push, optional emails) still apply on top.
 */
type Channel = "push" | "email";

export interface PushEmailSwitchesProps {
  /** a short id prefix for the aria wiring, unique on the page */
  id: string;
  title: string;
  blurb: string;
  initial: { push: boolean; email: boolean; ready: boolean };
  /** the PATCH body keys, e.g. { push: "giftPush", email: "giftEmail" } */
  keys: Record<Channel, string>;
  labels: Record<Channel, { title: string; desc: string }>;
}

export function PushEmailSwitches({ id, title, blurb, initial, keys, labels }: PushEmailSwitchesProps) {
  const [on, setOn] = useState<Record<Channel, boolean>>({ push: initial.push, email: initial.email });
  const [state, setState] = useState<Record<Channel, "idle" | "saving" | "saved" | "error">>({ push: "idle", email: "idle" });
  const [message, setMessage] = useState<string | null>(null);

  const toggle = async (ch: Channel) => {
    if (state[ch] === "saving" || !initial.ready) return;
    const next = !on[ch];
    setOn((o) => ({ ...o, [ch]: next }));
    setState((s) => ({ ...s, [ch]: "saving" }));
    setMessage(null);
    const res = await fetch("/api/notification-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [keys[ch]]: next }) }).catch(() => null);
    if (res?.ok) {
      setState((s) => ({ ...s, [ch]: "saved" }));
      return;
    }
    setOn((o) => ({ ...o, [ch]: !next }));
    setState((s) => ({ ...s, [ch]: "error" }));
    const j = (await res?.json().catch(() => null)) as { error?: string } | null;
    setMessage(j?.error ?? "Couldn't save. Try again.");
  };

  const row = (ch: Channel) => (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <h3 id={`${id}-${ch}-title`} className="text-[14px] font-semibold">
          {labels[ch].title}
        </h3>
        <p id={`${id}-${ch}-desc`} className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
          {labels[ch].desc}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on[ch]}
        aria-labelledby={`${id}-${ch}-title`}
        aria-describedby={`${id}-${ch}-desc`}
        aria-busy={state[ch] === "saving"}
        disabled={!initial.ready}
        onClick={() => void toggle(ch)}
        className="ex-switch mt-0.5"
      />
    </div>
  );

  const status = (ch: Channel) => (state[ch] === "saving" ? `Saving ${labels[ch].title}…` : state[ch] === "saved" ? `Saved. ${labels[ch].title} ${on[ch] ? "on" : "off"}.` : "");
  const anyError = state.push === "error" || state.email === "error";

  return (
    <section aria-labelledby={`${id}-title`} className="ex-card mb-4 px-4 py-4">
      <h2 id={`${id}-title`} className="text-[15px] font-semibold">
        {title}
      </h2>
      <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{blurb}</p>
      <div className="mt-2 divide-y divide-border">
        {row("push")}
        {row("email")}
      </div>
      <p aria-live="polite" className={cn("mt-1 min-h-[1.1rem] text-[12.5px] font-medium", anyError ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
        {!initial.ready ? "These switches arrive with the next update." : anyError ? message : [status("push"), status("email")].filter(Boolean).join(" ")}
      </p>
    </section>
  );
}
