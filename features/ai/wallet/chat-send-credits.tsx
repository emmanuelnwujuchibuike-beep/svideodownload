"use client";

import { useEffect, useState } from "react";

import { SendSheet, type PresetRecipient, type TransferRules } from "@/features/ai/wallet/transfer-panel";
import { toast } from "@/features/ui/toast";

/**
 * "Send credits" from a chat (owner, 2026-10-07: "make users can send credits
 * in chat, in the menu and in the plus button"). The SAME send sheet as the
 * credits page, with the person on the other side of the chat already chosen —
 * no wallet number to type. Its rules and the sender's balance are read once
 * when it opens (GET /api/ai/wallet/transfer); the chat loads none of this
 * until "Send credits" is tapped (callers import this lazily).
 */
export function ChatSendCredits({ recipient, onClose }: { recipient: PresetRecipient; onClose: () => void }) {
  const [state, setState] = useState<{ rules: TransferRules | null; balance: number | null; withdrawable?: number | null; deposited?: number | null } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/ai/wallet/transfer", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ rules: TransferRules | null; balance: number | null; withdrawable?: number | null; deposited?: number | null }>) : null))
      .then((d) => {
        if (!live) return;
        if (!d?.rules) {
          toast("Sending credits isn't available right now.", "info");
          onClose();
          return;
        }
        setState(d);
      })
      .catch(() => {
        if (live) {
          toast("Couldn't open that — check your connection.", "error");
          onClose();
        }
      });
    return () => {
      live = false;
    };
  }, [onClose]);

  if (!state?.rules) return null;
  return <SendSheet rules={state.rules} balance={state.balance} withdrawable={state.withdrawable ?? null} deposited={state.deposited ?? null} recipient={recipient} onClose={onClose} onSent={onClose} />;
}
