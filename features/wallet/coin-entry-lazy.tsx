"use client";

import dynamic from "next/dynamic";

import { useEntitlements } from "@/features/auth/use-entitlements";

import { useCoinGlance } from "./coin-glance";

/*
  The wallet entry points, kept OFF the pages that host them until they have something to show (owner, 2026-10-25:
  "make sure the pages didn't get heavy"). Measured on a production build: importing coin-entry directly added 3 kB to
  /messages/[id] and 1 kB to /u/[handle] while Frenz Coin was OFF and nothing rendered. Here the host page carries only
  the tiny glance hook; the entry's own code (amount, icons, layout) is fetched the first time a real balance exists.
*/
const Pill = dynamic(() => import("./coin-entry").then((m) => m.CoinHeaderPill));
const MenuCard = dynamic(() => import("./coin-entry").then((m) => m.CoinMenuCard));
const ChatSend = dynamic(() => import("./coin-entry").then((m) => m.CoinChatSend));

/** The /downloads header button: no balance (owner, 2026-10-25), so it needs only the "Frenz Coin is on" flag from /api/me — no wallet request. */
export function CoinHeaderPillLazy(props: { className?: string }) {
  const { frenzCoin, ready } = useEntitlements();
  return ready && frenzCoin ? <Pill {...props} /> : null;
}
export function CoinMenuCardLazy(props: { onNavigate?: () => void }) {
  return useCoinGlance() ? <MenuCard {...props} /> : null;
}
export function CoinChatSendLazy(props: { recipientId: string; name: string; onNavigate?: () => void }) {
  return useCoinGlance() ? <ChatSend {...props} /> : null;
}
