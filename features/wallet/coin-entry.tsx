"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import { CoinAmount } from "./coin-amount";
import { useCoinGlance } from "./coin-glance";
import { CloseWhenOpened, TapPending } from "./tap-pending";
import { ChevronRightIcon, SendIcon } from "./wallet-icons";

/*
  The wallet's ENTRY POINTS, from the owner's "Where the wallet lives" board (2026-10-25): the balance pill in the
  /downloads header (Entry 1), the "Frenz Coin wallet" card in the profile menu (Entry 2), and Send Frenz Coin in a
  chat's options. Each renders NOTHING until the member's real balance is known and Frenz Coin is on — never a
  placeholder figure. They share one read (coin-glance.ts).
*/

const INK_GLOW =
  "radial-gradient(80% 120% at 100% 0%, hsl(var(--frenz-magenta) / 0.55) 0%, hsl(var(--frenz-magenta) / 0) 60%), radial-gradient(70% 120% at 0% 100%, hsl(var(--frenz-blue) / 0.7) 0%, hsl(var(--frenz-blue) / 0) 62%), hsl(247 21% 8%)";

/**
 * Entry 1 — the /downloads header. Owner, 2026-10-25: "only the button with a premium glass wallet icon, the balance
 * shouldn't show on the Download page". A frosted round button — a faint brand tint, a bright rim — with the wallet glyph
 * drawn in the brand blue→violet. No balance, so it needs no balance read: it shows whenever Frenz Coin is on.
 */
export function CoinHeaderPill({ className }: { className?: string }) {
  return (
    <Link
      href="/wallet"
      prefetch={false}
      aria-label="Frenz Coin wallet"
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/80 bg-gradient-to-br from-white/90 via-frenz-blue/[0.06] to-frenz-violet/[0.14] shadow-[0_6px_18px_-8px_hsl(var(--frenz-violet)/0.55),inset_0_1px_0_rgba(255,255,255,0.9)] outline-none backdrop-blur-xl transition active:scale-95 focus-visible:ring-2 focus-visible:ring-frenz-blue motion-reduce:transition-none",
        className,
      )}
    >
      <TapPending size={18} className="text-frenz-violet">
      <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {/* userSpaceOnUse: a gradient on straight strokes paints nothing in objectBoundingBox units */}
        <defs>
          <linearGradient id="frenz-wallet-glyph" x1="3" y1="4" x2="21" y2="20" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="hsl(var(--frenz-blue))" />
            <stop offset="1" stopColor="hsl(var(--frenz-violet))" />
          </linearGradient>
        </defs>
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a1 1 0 0 1 1 1v2" stroke="url(#frenz-wallet-glyph)" />
        <rect x="3.5" y="8" width="17" height="11.5" rx="2.6" stroke="url(#frenz-wallet-glyph)" />
        <path d="M20.5 12h-3.25a1.75 1.75 0 0 0 0 3.5h3.25" stroke="url(#frenz-wallet-glyph)" />
        <circle cx="17.4" cy="13.75" r="0.9" fill="hsl(var(--frenz-violet))" />
      </svg>
      </TapPending>
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
      className="mx-4 mt-3 touch-manipulation flex items-center justify-between gap-3 overflow-hidden rounded-[22px] px-4 py-3.5 text-white shadow-frenz-raised outline-none transition active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-frenz-blue motion-reduce:transition-none"
      style={{ background: INK_GLOW }}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12px] font-semibold text-white/75">Frenz Coin wallet</span>
        <CoinAmount cents={g.availableCents} className="text-[26px] font-extrabold leading-tight tracking-[-0.8px]" />
      </span>
      <span className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-white/25 bg-white/10 px-3.5 text-[13px] font-bold backdrop-blur-md">
        Open{" "}
        <TapPending size={14}>
          <ChevronRightIcon size={14} strokeWidth={2.6} />
        </TapPending>
      </span>
      <CloseWhenOpened onOpened={onNavigate} />
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
      className="mt-4 flex touch-manipulation w-full items-center gap-3 rounded-[20px] p-3.5 text-left text-white shadow-frenz-card outline-none transition active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2 motion-reduce:transition-none"
      style={{ background: INK_GLOW }}
    >
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
        <TapPending size={18}>
          <SendIcon size={19} />
        </TapPending>
      </span>
      <CloseWhenOpened onOpened={onNavigate} />
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
