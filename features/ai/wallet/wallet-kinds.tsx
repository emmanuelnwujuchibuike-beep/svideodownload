import { Gem, Hexagon } from "lucide-react";

/**
 * The two kinds of balance, by name (owner, 2026-10-09: "make the non-withdrawable
 * credits tokens and the withdrawable credits credits. Same value, just an icon
 * (symbol) change … the name change should only show in the dashboard and when
 * sending. When earning and depositing it stays credits").
 *
 *   Tokens   the non-withdrawable part, a hexagon: spend on Frenz AI tools
 *   Credits  the withdrawable part, a gem: can be cashed out
 *
 * One token = one credit = one wallet unit. Only the name and the symbol differ.
 * The credits page and the send sheet use this module; earn, deposit and the AI
 * credit strip keep the word "credits".
 */
export type WalletKind = "usable" | "withdrawable";

export const KIND_NAME: Record<WalletKind, { one: string; many: string; title: string }> = {
  usable: { one: "token", many: "tokens", title: "Tokens" },
  withdrawable: { one: "credit", many: "credits", title: "Credits" },
};

export function formatKind(n: number, kind: WalletKind): string {
  const v = Math.max(0, Math.floor(n));
  return `${v.toLocaleString("en-US")} ${v === 1 ? KIND_NAME[kind].one : KIND_NAME[kind].many}`;
}

export function KindSymbol({ kind, className = "h-3.5 w-3.5" }: { kind: WalletKind; className?: string }) {
  const Icon = kind === "usable" ? Hexagon : Gem;
  return <Icon className={className} aria-hidden strokeWidth={2.4} />;
}
