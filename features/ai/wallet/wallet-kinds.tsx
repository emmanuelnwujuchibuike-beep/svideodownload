import { Banknote, Gem } from "lucide-react";

/**
 * The two kinds of balance, by name.
 *
 * 2026-10-09 (owner) named them Tokens and Credits. 2026-10-30 (owner): "remove the AI token, so only AI credit is
 * there" — cashing out is for approved affiliates only (lib/rewards/affiliate-status.ts), so for everyone the balance is
 * AI credits:
 *
 *   AI credits       the spendable part: every Frenz AI tool spends from it
 *   Withdrawable     an approved affiliate's cash-out part (commissions, rewards after approval, deposits)
 *   Deposit credits  the same stored kind for everyone else — paid-in credits, sendable at their own fee, never cashed out
 *
 * One credit = one wallet unit whatever its kind; only the name and the symbol differ.
 */
export type WalletKind = "usable" | "withdrawable";

export const KIND_NAME: Record<WalletKind, { one: string; many: string; title: string }> = {
  usable: { one: "credit", many: "credits", title: "AI credits" },
  withdrawable: { one: "credit", many: "credits", title: "Withdrawable" },
};

/** The kind's title for this member: the withdrawable kind is "Deposit credits" to anyone who isn't an affiliate. */
export function kindTitle(kind: WalletKind, affiliate: boolean): string {
  return kind === "withdrawable" && !affiliate ? "Deposit credits" : KIND_NAME[kind].title;
}

export function formatKind(n: number, kind: WalletKind): string {
  const v = Math.max(0, Math.floor(n));
  return `${v.toLocaleString("en-US")} ${v === 1 ? KIND_NAME[kind].one : KIND_NAME[kind].many}`;
}

export function KindSymbol({ kind, className = "h-3.5 w-3.5" }: { kind: WalletKind; className?: string }) {
  const Icon = kind === "usable" ? Gem : Banknote;
  return <Icon className={className} aria-hidden strokeWidth={2.4} />;
}
