"use client";

import { Check, Copy, LifeBuoy, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { REPLACEMENT_MODE_COPY, isReplacementMode } from "@/lib/ai/character-replace/modes";
import type { CharacterReplaceTransaction } from "@/lib/ai/character-replace/types";
import { formatCents } from "@/lib/ai/economy";
import { AI_CURRENCIES, isAiCurrency } from "@/lib/landing/bounds";
import { formatDate, formatTime } from "@/lib/i18n/format";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * One statement line, in full (owner, 2026-09-20: "make the AI statement
 * show the full details of each statement and the ID and all details so
 * users can screenshot it to apply for support").
 *
 * Every fact the row carries, laid out to be screenshotted: the kind, the
 * amount in the row's OWN currency (a line from before the wallet moved to
 * US dollars is still in naira), the balance after, the exact time, the
 * transaction id, a recharge's payment reference, the video id, and what a
 * charge was priced for. "Copy details" puts the same block on the
 * clipboard as plain text for a support message. Nothing here is a rate or
 * a provider name.
 *
 * A bottom sheet on a phone, a centred card from sm:; portaled (the fixed-
 * overlay law); transform/opacity only; body scroll lock by overflowY.
 */
const LABEL: Record<string, string> = {
  recharge: "Balance added",
  processing_charge: "Character Replace video",
  refund: "Refunded",
  adjustment: "Adjustment by Frenz",
  reversal: "Reversed",
};
const STATUS: Record<string, string> = { settled: "Settled", reserved: "Reserved — the video is still running", refunded: "Refunded", reversed: "Reversed" };
const QUALITY: Record<string, string> = { standard: "Standard", high: "High", ultra: "Ultra", "480p": "480p", "720p": "720p", "1080p": "1080p" };

export function symbolFor(currency: string | undefined, fallback: string): string {
  return currency && isAiCurrency(currency) ? AI_CURRENCIES[currency] : fallback;
}

export function StatementDetailSheet({ row, symbol, onClose }: { row: CharacterReplaceTransaction | null; symbol: string; onClose: () => void }) {
  const open = row !== null;
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setCopied(false);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // the last row is kept through the closing animation
  const [last, setLast] = useState<CharacterReplaceTransaction | null>(row);
  useEffect(() => {
    if (row) setLast(row);
  }, [row]);
  const r = row ?? last;
  if (!mounted || !r || typeof document === "undefined") return null;

  const sym = symbolFor(r.currency, symbol);
  const kind = LABEL[r.kind] ?? r.kind;
  const amount = `${r.deltaCents > 0 ? "+" : ""}${formatCents(r.deltaCents, sym)}`;
  const when = `${formatDate(r.createdAt)} · ${formatTime(r.createdAt)}`;
  const d = r.details;
  const facts: [string, string][] = [
    ["Type", kind],
    ["Amount", amount],
    ["Balance after", formatCents(r.balanceAfterCents, sym)],
    ["Status", r.status ? (STATUS[r.status] ?? r.status) : "Settled"],
    ["Date", when],
    ["Currency", r.currency ?? "—"],
    ["Transaction ID", r.id],
  ];
  if (r.reference) facts.push(["Payment reference", r.reference]);
  if (r.jobId) facts.push(["Video ID", r.jobId]);
  if (d) {
    facts.push(["Replacement", isReplacementMode(d.mode) ? REPLACEMENT_MODE_COPY[d.mode].label : d.mode]);
    facts.push(["Quality", QUALITY[d.quality] ?? d.quality]);
    facts.push(["Video length", `${(Math.round(d.durationMs / 100) / 10).toFixed(1)} s`]);
    facts.push(["Voice", d.voiceMode === "new_voice" ? (d.voiceSource === "tts" ? "New voice from text" : "Your audio") : "Original audio"]);
    facts.push(["Lip sync", d.lipSyncMode ? (d.lipSyncMode === "studio" ? "Studio" : "Standard") : "Not selected"]);
    facts.push(["Price list", `v${d.pricingConfigVersion}`]);
  }
  if (r.note) facts.push(["Note", r.note]);
  const text = ["Frenz AI · Character Replace statement line", ...facts.map(([k, v]) => `${k}: ${v}`)].join("\n");

  const copy = async () => {
    haptic("selection");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* no clipboard: the block is on screen to screenshot */
    }
  };

  return createPortal(
    <div className={open ? "" : "pointer-events-none"}>
      <button type="button" aria-label="Close" onClick={onClose} className={cn("fixed inset-0 z-[70] cursor-default bg-slate-950/45 transition-opacity duration-200", shown ? "opacity-100" : "opacity-0")} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="statement-line-title"
        className={cn(
          "fixed inset-x-0 bottom-0 z-[80] flex max-h-[90vh] flex-col overflow-hidden rounded-t-[1.75rem] bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_48px_-12px_rgba(15,23,42,0.45)] ring-1 ring-border/60",
          "transition-[transform,opacity] duration-300 [transition-timing-function:var(--ease-out)]",
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,30rem)] sm:rounded-[1.75rem] sm:pb-0",
          shown ? "translate-y-0 opacity-100 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:scale-100" : "translate-y-full opacity-0 sm:-translate-x-1/2 sm:-translate-y-[46%] sm:scale-[0.96]",
        )}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" />
        <header className="flex items-start gap-3 px-5 pt-4 sm:pt-5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Statement line</p>
            <h2 id="statement-line-title" className="mt-0.5 text-[1.15rem] font-extrabold tracking-tight">
              {kind}
            </h2>
            <p className={cn("mt-1 text-[1.6rem] font-bold leading-none tracking-[-0.03em] tabular-nums", r.deltaCents > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>{amount}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground">
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </header>

        <dl className="mt-4 divide-y divide-border/60 overflow-y-auto px-5 text-[13px]">
          {facts.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-muted-foreground">{k}</dt>
              <dd className={cn("min-w-0 text-right font-semibold", /ID|reference/.test(k) && "break-all font-mono text-[12px]")}>{v}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-2 px-5 pb-5 pt-4 sm:pb-6">
          <button
            type="button"
            onClick={copy}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-4 text-[13px] font-bold text-background transition active:scale-[0.98]"
          >
            {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            {copied ? "Copied" : "Copy details"}
          </button>
          <Link
            href="/support"
            onClick={onClose}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold transition hover:border-foreground/30"
          >
            <LifeBuoy className="h-4 w-4" aria-hidden />
            Get help
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}
