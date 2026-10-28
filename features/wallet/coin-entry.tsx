"use client";

import Link from "next/link";

import { IconTile } from "@/components/icons/icon-tile";
import { cn } from "@/lib/utils";

import { CloseWhenOpened, TapPending } from "./tap-pending";
import { ChevronRightIcon } from "./wallet-icons";

/*
  The wallet's ENTRY POINTS, from the owner's "Where the wallet lives" board (2026-10-25): the balance pill in the
  /downloads header (Entry 1), the "Frenz Coin wallet" card in the profile menu (Entry 2), and Send Frenz Coin in a
  chat's options. Each renders NOTHING until the member's real balance is known and Frenz Coin is on — never a
  placeholder figure. They share one read (coin-glance.ts).
*/

/**
 * Entry 1 — the /downloads header. Owner, 2026-10-25: no balance on the Download page, then "make the wallet button
 * embed on the header": the wallet glyph in the brand blue→violet, set into the bar like the search and bell icons. No balance, so it needs no balance read: it shows whenever Frenz Coin is on.
 */
export function CoinHeaderPill({ className }: { className?: string }) {
  return (
    <Link
      href="/wallet"
      prefetch={false}
      aria-label="Frenz Coin wallet"
      // set INTO the header like the search and bell icons (owner, 2026-10-25: "make the wallet button embed on the header")
      className={cn("inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full outline-none transition active:scale-90 focus-visible:ring-2 focus-visible:ring-frenz-blue motion-reduce:transition-none", className)}
    >
      <IconTile>
      <TapPending size={18} className="text-frenz-violet">
      <svg aria-hidden width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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
      </IconTile>
    </Link>
  );
}

/** The wallet glyph, in the current text colour (the rows below). */
function WalletGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17a1 1 0 0 1 1 1v2" />
      <rect x="3.5" y="8" width="17" height="11.5" rx="2.6" />
      <path d="M20.5 12h-3.25a1.75 1.75 0 0 0 0 3.5h3.25" />
    </svg>
  );
}

/*
  Owner, 2026-10-27: "convert this Send Frenz Coin button in the chat menu and in the profile menu to be just a wallet and
  coin button that prefetches and responds to tap instantly — to cut weight and less visual noise, each button with a
  description". So both are now quiet rows like their neighbours: the glyph, a title, ONE line saying what it does, and
  a chevron that turns into the tap spinner. No balance figure and no dark card — the amount component and its read are
  gone from these surfaces (the wallet itself shows the balance). Both are main buttons, so both prefetch.
*/
const ROW =
  "flex w-full touch-manipulation items-center gap-3 rounded-[18px] border border-frenz-line bg-frenz-card px-3.5 py-2.5 text-left text-frenz-ink outline-none transition active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2 motion-reduce:transition-none min-h-[56px]";

function RowBody({ title, description }: { title: string; description: string }) {
  return (
    <>
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-frenz-fill text-frenz-violet">
        <WalletGlyph />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-heading text-[14px] font-bold">{title}</span>
        <span className="truncate text-[13px] text-frenz-muted">{description}</span>
      </span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-frenz-muted">
        <TapPending size={16}>
          <ChevronRightIcon size={16} strokeWidth={2.4} />
        </TapPending>
      </span>
    </>
  );
}

/** Entry 2 — the profile menu: the Frenz Coin wallet, as one quiet row. */
export function CoinMenuCard({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="mx-4 mt-3">
      <Link href="/wallet" className={ROW}>
        <RowBody title="Frenz Coin wallet" description="Your balance, deposits, withdrawals and transfers" />
        <CloseWhenOpened onOpened={onNavigate} />
      </Link>
    </div>
  );
}

/**
 * In a chat's options: Frenz Coin to the person you're talking to — the wallet's own transfer screen, with them
 * already chosen (the server resolves who they are; nothing is sent until the member reviews and enters their PIN).
 */
export function CoinChatSend({ recipientId, name, onNavigate }: { recipientId: string; name: string; onNavigate?: () => void }) {
  return (
    <Link href={`/wallet/transfer?to=${encodeURIComponent(recipientId)}`} className={cn(ROW, "mt-4")}>
      <RowBody title="Send Frenz Coin" description={`Send money to ${name} from your wallet`} />
      <CloseWhenOpened onOpened={onNavigate} />
    </Link>
  );
}
