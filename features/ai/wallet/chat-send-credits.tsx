"use client";

import { useEffect, useState } from "react";

import { SendSheet, type PresetRecipient, type TransferRules } from "@/features/ai/wallet/transfer-panel";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { toast } from "@/features/ui/toast";

/**
 * "Send credits" from a chat (owner, 2026-10-07: "make users can send credits
 * in chat, in the menu and in the plus button"). The SAME send sheet as the
 * credits page, with the person on the other side of the chat already chosen —
 * no wallet number to type.
 *
 * 2026-10-14 (owner: "respond instantly like the promote button … cache at
 * first time so it doesn't load on every click"): the chat menu warms this
 * module and the wallet read while it is idle (`prefetchSendCredits`), and the
 * read is kept for the tab. A tap paints the sheet in the same frame from that
 * copy. The balance is re-read quietly behind it, and only a real change
 * repaints. A completed transfer drops the copy, since the balance moved.
 */
/**
 * `aboveZ`: the layer it was opened from (the chat menu sits at z-110). The send
 * sheet opens above it, never under it (owner 2026-10-11).
 */
interface WalletRead {
  rules: TransferRules | null;
  balance: number | null;
  withdrawable?: number | null;
  deposited?: number | null;
}

/** How long a kept read is shown without a quiet re-read behind it. */
const FRESH_MS = 30_000;
let kept: { data: WalletRead; at: number } | null = null;
let inflight: Promise<WalletRead | null> | null = null;

function readWallet(): Promise<WalletRead | null> {
  if (inflight) return inflight;
  inflight = fetch("/api/ai/wallet/transfer", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<WalletRead>) : null))
    .then((d) => {
      if (d?.rules) kept = { data: d, at: Date.now() };
      return d;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Warm the sheet's data once per tab — called by the chat menu while idle and on press. */
export function prefetchSendCredits(): void {
  if (kept && Date.now() - kept.at < FRESH_MS) return;
  void readWallet().catch(() => {});
}

export function ChatSendCredits({ recipient, onClose, aboveZ }: { recipient: PresetRecipient; onClose: () => void; aboveZ?: number }) {
  const [state, setState] = useState<WalletRead | null>(() => kept?.data ?? null);

  useEffect(() => {
    let live = true;
    const had = !!kept;
    if (had && Date.now() - kept!.at < FRESH_MS) return;
    readWallet()
      .then((d) => {
        if (!live) return;
        if (!d?.rules) {
          // a kept copy stays usable when only the re-read failed
          if (had) return;
          toast("Sending credits isn't available right now.", "info");
          onClose();
          return;
        }
        setState((s) => (s && JSON.stringify(s) === JSON.stringify(d) ? s : d));
      })
      .catch(() => {
        if (live && !had) {
          toast("Couldn't open that — check your connection.", "error");
          onClose();
        }
      });
    return () => {
      live = false;
    };
  }, [onClose]);

  const backdropZ = aboveZ ? aboveZ + 10 : undefined;
  const panelZ = aboveZ ? aboveZ + 11 : undefined;

  if (!state?.rules) {
    // first tap ever, before the warm-up landed: the sheet still opens at once, filling in as the read answers
    return (
      <GlassSheetShell open onClose={onClose} title="Send credits" fitContent defaultHeightVh={78} {...(backdropZ ? { backdropZ } : {})} {...(panelZ ? { panelZ } : {})}>
        <div className="space-y-3 px-4 pb-6" aria-busy="true" aria-label="Loading">
          <div className="h-14 animate-pulse rounded-2xl bg-secondary/70 motion-reduce:animate-none" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-[3.25rem] animate-pulse rounded-2xl bg-secondary/60 motion-reduce:animate-none" />
            <div className="h-[3.25rem] animate-pulse rounded-2xl bg-secondary/60 motion-reduce:animate-none" />
          </div>
          <div className="h-12 animate-pulse rounded-2xl bg-secondary/60 motion-reduce:animate-none" />
          <div className="h-12 animate-pulse rounded-full bg-secondary/70 motion-reduce:animate-none" />
        </div>
      </GlassSheetShell>
    );
  }
  return (
    <SendSheet
      backdropZ={backdropZ}
      panelZ={panelZ}
      rules={state.rules}
      balance={state.balance}
      withdrawable={state.withdrawable ?? null}
      deposited={state.deposited ?? null}
      recipient={recipient}
      onClose={onClose}
      onSent={() => {
        // the balance moved: the next open re-reads it
        kept = null;
        onClose();
      }}
    />
  );
}
