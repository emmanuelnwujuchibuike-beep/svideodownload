"use client";

import { ArrowRight, Bell, Check, GraduationCap, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { hrefFor, recommend } from "@/lib/download-hub/recommend";
import type { DownloadContext, Recommendation } from "@/lib/download-hub/types";
import { lessonForAction } from "@/lib/learning/catalog";
import { cn } from "@/lib/utils";

import { useGatewayMemory } from "./use-gateway-memory";

/**
 * Discovery Gateway™ — the panel that turns one completed download into an entry
 * point to the rest of the ecosystem. See `docs/DOWNLOAD_HUB_RFC.md` §3.
 *
 * Two rules govern this component and neither is negotiable:
 *
 *   1. It renders AFTER the file is saved. It never blocks, delays or gates the
 *      download. The moment discovery interferes with the job the user came to do,
 *      the downloader stops being the acquisition channel that makes the rest of
 *      this worth building.
 *   2. Tense follows availability. Eight of the destinations in the catalogue do
 *      not exist yet; those render in future tense with a real waitlist, never as
 *      a CTA that pretends to open something.
 */

interface DiscoveryGatewayProps {
  context: DownloadContext;
  className?: string;
}

export function DiscoveryGateway({ context, className }: DiscoveryGatewayProps) {
  const { memory, dismiss, markTaken } = useGatewayMemory();

  // Ranked on the client from a static catalogue — no request, no waterfall, and
  // nothing that could un-static the page this renders on.
  const recommendations = useMemo(
    () => recommend(context, { memory }),
    [context, memory],
  );

  const lesson = useMemo(() => {
    for (const rec of recommendations) {
      const found = lessonForAction(rec.action.id);
      if (found) return found;
    }
    return undefined;
  }, [recommendations]);

  useEffect(() => {
    if (recommendations.length === 0) return;
    // Fire-and-forget: an impression that fails to record must never surface to
    // the user or delay anything.
    void fetch("/api/download-hub/impressions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionIds: recommendations.map((r) => r.action.id),
        platformId: context.platformId,
        kind: context.kind,
      }),
      keepalive: true,
    }).catch(() => {});
  }, [recommendations, context.platformId, context.kind]);

  if (recommendations.length === 0) return null;

  return (
    <section
      className={cn(
        "mt-5 overflow-hidden rounded-2xl border border-border/60 bg-card p-4 sm:p-5",
        // The panel appears mid-flow, after a download the user just triggered,
        // so it arrives rather than pops. Compositor-only (transform + opacity)
        // and skipped entirely under reduced-motion.
        "motion-safe:animate-fade-up",
        className,
      )}
      aria-label="What you can do next"
    >
      <header>
        <h2 className="text-sm font-bold">Saved. What next?</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Optional — your file is already downloaded.
        </p>
      </header>

      <ul className="mt-4 space-y-2">
        {recommendations.map((rec, i) => (
          <GatewayRow
            key={rec.action.id}
            rec={rec}
            context={context}
            // Short stagger so the options read in priority order rather than
            // landing as one block. Kept under ~200ms total: past that a stagger
            // stops feeling considered and starts feeling slow.
            index={i}
            onDismiss={() => dismiss(rec.action.id)}
            onTake={() => markTaken(rec.action.id)}
          />
        ))}
      </ul>

      {lesson ? (
        <Link
          href={`/learn/${lesson.slug}`}
          className="mt-3 flex items-center gap-2.5 rounded-xl px-2 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <GraduationCap className="h-4 w-4 shrink-0" />
          <span className="flex-1">{lesson.title}</span>
          <span className="shrink-0 tabular-nums">{lesson.minutes} min</span>
        </Link>
      ) : null}
    </section>
  );
}

/* --------------------------------- one row -------------------------------- */

function GatewayRow({
  rec,
  context,
  index,
  onDismiss,
  onTake,
}: {
  rec: Recommendation;
  context: DownloadContext;
  index: number;
  onDismiss: () => void;
  onTake: () => void;
}) {
  const { action, availability, label, reason } = rec;
  const Icon = action.icon;
  const href = hrefFor(rec, context);
  const isPlanned = availability === "planned";

  const body = (
    <>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          isPlanned ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-primary",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {/*
            The visible label is the PRESENT-tense one even when planned, because
            the "coming soon" signal is carried by the shrink-0 chip beside it
            instead. Putting it in the label itself was a truthfulness bug: on a
            narrow screen "Trim and edit — coming soon" truncated to "Trim and
            edit — …", which reads as available. A chip cannot be truncated away.
            `rec.label` (with the tense) still goes to assistive tech below.
          */}
          <span className="truncate text-sm font-medium">{action.label}</span>
          {isPlanned ? (
            <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Soon
            </span>
          ) : null}
          {availability === "preview" ? (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
              Beta
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {/* A recommendation that cannot explain itself reads as an advert. */}
          {reason} · {action.description}
        </span>
      </span>
    </>
  );

  return (
    <li
      className="group flex items-center gap-1 motion-safe:animate-fade-up"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {isPlanned ? (
        <WaitlistRow action={action.id} onJoined={onTake}>
          {body}
        </WaitlistRow>
      ) : href ? (
        <Link
          href={href}
          onClick={onTake}
          // `min-w-0` is load-bearing: a flex-1 item defaults to min-width:auto,
          // so a long description grows the row past its container instead of
          // truncating — which pushes the arrow and dismiss button off the panel.
          className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-200 hover:bg-secondary motion-safe:transition-[background-color,transform] motion-safe:active:scale-[0.98]"
        >
          {body}
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss ${label}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/* -------------------------------- waitlist -------------------------------- */

/**
 * A `planned` destination. The row is not a link, because there is nothing to
 * link to — it writes a real waitlist row instead. That is what makes showing an
 * unbuilt product here honest rather than decorative.
 */
function WaitlistRow({
  action,
  onJoined,
  children,
}: {
  action: string;
  onJoined: () => void;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");

  const join = async () => {
    if (state !== "idle") return;
    setState("saving");
    try {
      const res = await fetch("/api/download-hub/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      // Optimism is wrong here: claiming someone is on a list they are not on is
      // the same class of dishonesty the whole availability system exists to stop.
      if (!res.ok) {
        setState("idle");
        return;
      }
      setState("done");
      onJoined();
    } catch {
      setState("idle");
    }
  };

  return (
    <button
      type="button"
      onClick={join}
      disabled={state !== "idle"}
      className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-200 hover:bg-secondary disabled:cursor-default motion-safe:transition-[background-color,transform] motion-safe:active:scale-[0.98]"
    >
      {children}
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {state === "done" ? (
          <>
            <Check className="h-3.5 w-3.5" /> We&apos;ll tell you
          </>
        ) : (
          <>
            <Bell className="h-3.5 w-3.5" />
            {state === "saving" ? "…" : "Notify me"}
          </>
        )}
      </span>
    </button>
  );
}
