"use client";

import { useEffect, useRef } from "react";

import { Portal } from "@/components/ui/portal";
import type { ActivityItem } from "@/lib/admin/activity";
import { cn } from "@/lib/utils";

/**
 * Everything one live-activity row actually knows.
 *
 * Owner, 2026-08-31: "when i click on a live activity download or ad
 * impression, clicks, install, upgrade view, it doesnt show anything, it should
 * show all details and information of each."
 *
 * That was accurate — the rows were plain `<li>`s with no handler, and the feed
 * had already reduced each event to a one-line summary, so there was nothing to
 * open. `ActivityItem.meta` now carries the row's full logged payload and this
 * renders ALL of it.
 *
 * ── Why it renders whatever it finds, rather than a per-kind layout ──────────
 *
 * An operator opening this is asking "what exactly happened", usually because
 * something looks wrong. A hand-written layout per kind shows only the fields
 * someone thought of, silently omits any key added later, and is the reason
 * this kind of panel goes stale. Iterating the payload means a new field logged
 * by an ad unit next month appears here the day it ships, with no change.
 *
 * Values are rendered as text, never as HTML, and long ones wrap — a URL from a
 * third-party ad network is untrusted input.
 */

/** `snake_case` / `camelCase` → "Snake case" / "Camel case", for the labels. */
function humanize(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Is this value something the operator can open?
 *
 * Strictly http(s) — anything else (`javascript:`, `data:`) must never become a
 * live link in an admin panel, and these values come from third-party ad
 * networks and user-pasted source URLs.
 */
function isHttpUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** A download's outcome, read at a glance rather than as another grey string. */
const STATUS_TINT: Record<string, string> = {
  completed: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  failed: "bg-red-500/12 text-red-600 dark:text-red-300",
  cancelled: "bg-amber-500/12 text-amber-600 dark:text-amber-300",
  queued: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
  downloading: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
};

/** Primitives print directly; objects/arrays print as indented JSON. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length === 0 ? "—" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ActivityDetail({ item, onClose }: { item: ActivityItem; onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const when = new Date(item.at);
  /*
    The core facts first, then the payload. `meta` keys that duplicate something
    already shown above are dropped so the panel does not print the same value
    twice under two names.
  */
  const base: [string, unknown][] = [
    ["Type", item.label],
    ["Kind", item.kind],
    ["Who", item.actor ? `${item.actor.displayName} (@${item.actor.handle})` : "Anonymous / signed-out"],
    ["When", `${when.toLocaleString()} · ${item.at}`],
    ["Summary", item.detail],
  ];
  const skip = new Set(["eventType"]);
  const extra = Object.entries(item.meta ?? {}).filter(([k]) => !skip.has(k));

  return (
    <Portal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-detail-title"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:items-center"
      >
        <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto overscroll-contain rounded-3xl border border-border/60 bg-card p-4 shadow-2xl sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id="activity-detail-title" className="text-base font-extrabold tracking-tight">
              {item.label}
            </h2>
            <button
              ref={closeBtn}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground ring-1 ring-inset ring-border/60 transition hover:bg-secondary"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden focusable="false">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />
              </svg>
            </button>
          </div>

          <dl className="mt-3 divide-y divide-border/50">
            {base.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[6.5rem_1fr] gap-3 py-2">
                <dt className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words text-[13px]">{renderValue(value)}</dd>
              </div>
            ))}
            {extra.map(([key, value]) => {
              const text = renderValue(value);
              const isBlock = text.includes("\n");
              return (
                <div key={key} className="grid grid-cols-[6.5rem_1fr] gap-3 py-2">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    {humanize(key)}
                  </dt>
                  <dd className="min-w-0 break-words text-[13px]">
                    {isBlock ? (
                      <pre className="overflow-x-auto rounded-lg bg-secondary/50 p-2 text-[11.5px] leading-snug">
                        {text}
                      </pre>
                    ) : isHttpUrl(text) ? (
                      /*
                        🔴 Owner: "and link so i can click to open in the
                        platform." A source URL is the one field an operator
                        actually needs to ACT on — to go and look at the TikTok
                        or Instagram post a download came from.

                        `noopener noreferrer` because this is a third-party URL
                        the app did not author: `noopener` stops the opened page
                        reaching back through `window.opener`, and `noreferrer`
                        keeps the admin URL out of its referer log.
                      */
                      <a
                        href={text}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all font-medium text-blue-600 underline underline-offset-2 hover:text-blue-500 dark:text-blue-400"
                      >
                        {text}
                      </a>
                    ) : key === "status" ? (
                      <span
                        className={cn(
                          "inline-flex rounded-md px-1.5 py-0.5 text-[11.5px] font-bold uppercase tracking-wide",
                          STATUS_TINT[text] ?? "bg-secondary text-muted-foreground",
                        )}
                      >
                        {text}
                      </span>
                    ) : (
                      text
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>

          {extra.length === 0 ? (
            /*
              Honest rather than empty. Some event types genuinely log no
              payload, and saying so is very different from a panel that opens
              blank — which is what the operator was looking at before.
            */
            <p className="mt-2 rounded-xl bg-secondary/40 p-3 text-[12px] text-muted-foreground">
              This event was logged with no extra payload — everything recorded for it is shown
              above.
            </p>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}
