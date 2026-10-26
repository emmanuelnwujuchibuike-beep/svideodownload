"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import { CoinAmount } from "./coin-amount";
import { useCoinGlance } from "./coin-glance";
import { ChevronRightIcon, SendIcon } from "./wallet-icons";

/*
  The wallet's ENTRY POINTS, from the owner's "Where the wallet lives" board (2026-10-25): the balance pill in the
  /downloads header (Entry 1), the "Frenz Coin wallet" card in the profile menu (Entry 2), and Send Frenz Coin in a
  chat's options. Each renders NOTHING until the member's real balance is known and Frenz Coin is on — never a
  placeholder figure. They share one read (coin-glance.ts).
*/

const INK_GLOW =
  "radial-gradient(80% 120% at 100% 0%, hsl(var(--frenz-magenta) / 0.55) 0%, hsl(var(--frenz-magenta) / 0) 60%), radial-gradient(70% 120% at 0% 100%, hsl(var(--frenz-blue) / 0.7) 0%, hsl(var(--frenz-blue) / 0) 62%), hsl(247 21% 8%)";

/** The coin mark: the brand ring around an "F" (the board's pill and card). */
function Mark({ size = 22 }: { size?: number }) {
  return (
    <span aria-hidden className="flex shrink-0 rounded-full bg-frenz-gradient p-[2px]" style={{ width: size, height: size }}>
      <span className="flex flex-1 items-center justify-center rounded-full bg-frenz-ink font-heading text-[10px] font-extrabold text-white">F</span>
    </span>
  );
}

/** Entry 1 — the /downloads header: "(F) FC 24,850" beside the bell. Whole coins only, like the board. */
export function CoinHeaderPill({ className }: { className?: string }) {
  const g = useCoinGlance();
  if (!g) return null;
  return (
    <Link
      href="/wallet"
      prefetch={false}
      aria-label={`Frenz Coin wallet, FC ${(g.availableCents / 100).toFixed(2)} available`}
      className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-frenz-line bg-frenz-card pl-1 pr-3 shadow-frenz-card outline-none transition active:scale-95 focus-visible:ring-2 focus-visible:ring-frenz-blue motion-reduce:transition-none", className)}
    >
      <Mark size={26} />
      <CoinAmount cents={Math.trunc(g.availableCents / 100) * 100} className="text-[14px] font-bold text-frenz-ink" fractionClassName="hidden" />
    </Link>
  );
}

/** Entry 2 — the profile menu card: "Frenz Coin wallet", the balance as a currency, and "Open ›". */
export function CoinMenuCard({ onNavigate }: { onNavigate?: () => void }) {
  const g = useCoinGlance();
  if (!g) return null;
  return (
    <Link
      href="/wallet"
      prefetch={false}
      onClick={onNavigate}
      className="mx-4 mt-3 flex items-center justify-between gap-3 overflow-hidden rounded-[22px] px-4 py-3.5 text-white shadow-frenz-raised outline-none transition active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-frenz-blue motion-reduce:transition-none"
      style={{ background: INK_GLOW }}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12px] font-semibold text-white/75">Frenz Coin wallet</span>
        <CoinAmount cents={g.availableCents} className="text-[26px] font-extrabold leading-tight tracking-[-0.8px]" />
      </span>
      <span className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-white/25 bg-white/10 px-3.5 text-[13px] font-bold backdrop-blur-md">
        Open <ChevronRightIcon size={14} strokeWidth={2.6} />
      </span>
    </Link>
  );
}

/**
 * In a chat's options: "Send Frenz Coin" to the person you're talking to — the wallet's own transfer screen, with them
 * already chosen (the server resolves who they are; nothing is sent until the member reviews and enters their PIN).
 */
export function CoinChatSend({ recipientId, name, onNavigate }: { recipientId: string; name: string; onNavigate?: () => void }) {
  const g = useCoinGlance();
  if (!g) return null;
  return (
    <Link
      href={`/wallet/transfer?to=${encodeURIComponent(recipientId)}`}
      prefetch={false}
      onClick={onNavigate}
      className="mt-4 flex w-full items-center gap-3 rounded-[20px] p-3.5 text-left text-white shadow-frenz-card outline-none transition active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2 motion-reduce:transition-none"
      style={{ background: INK_GLOW }}
    >
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
        <SendIcon size={19} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-heading text-[15px] font-bold">Send Frenz Coin</span>
        <span className="truncate text-[13px] text-white/80">Send money to {name}</span>
      </span>
      <span className="shrink-0 text-right text-[12px] leading-tight text-white/80">
        Available
        <CoinAmount cents={g.availableCents} className="block text-[14px] font-bold text-white" />
      </span>
    </Link>
  );
}
