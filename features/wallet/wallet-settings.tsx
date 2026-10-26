"use client";

import Link from "next/link";
import { useState } from "react";

import { walletApi, type SavedBank, type WalletPrefs } from "./api";
import { BankIcon, BellIcon, ChevronRightIcon, EyeOffIcon, KeyIcon, UserIcon } from "./wallet-icons";
import { Notice, SectionTitle, SubHeader, WalletScreen } from "./wallet-ui";
import { cn } from "@/lib/utils";

export interface WalletSettingsProps {
  pin: { available: boolean; set: boolean; lockedUntil: string | null };
  prefs: WalletPrefs;
  banks: SavedBank[];
  recipients: { id: string; name: string; handle: string | null }[];
}

const ROW = "flex min-h-[56px] items-center gap-3 px-4 py-3 text-left";
const CARD = "mx-4 flex flex-col divide-y divide-frenz-line overflow-hidden rounded-[22px] bg-frenz-fill/60";

/**
 * /wallet/settings (owner, 2026-10-26: "there is no users wallet settings to change pin, and notification settings").
 * Everything a member can set about their own wallet, in one place, from what already exists:
 *   · the transaction PIN — set, change, reset — is the existing /wallet/security screen (not rebuilt);
 *   · push alerts for money in, money out and withdrawals, and "hide my balance" (lib/coin/wallet-prefs.ts);
 *   · saved bank accounts — the member's SUB payout account and the banks of earlier withdrawals (lib/coin/saved-banks.ts);
 *   · recent recipients — from their own transfer history (lib/coin/recipients.ts).
 * A switch moves the instant it is tapped; the server confirms, and a failed save puts it back and says so.
 */
export function WalletSettings({ pin, prefs: initial, banks, recipients }: WalletSettingsProps) {
  const [prefs, setPrefs] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (key: keyof WalletPrefs) => {
    const before = prefs;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setError(null);
    const r = await walletApi.savePrefs({ [key]: next[key] });
    if (!r.ok) {
      setPrefs(before);
      setError(r.session === "expired" ? "Your session ended. Sign in again to change your wallet settings." : r.error || "Couldn't save that. Try again.");
    } else setPrefs(r.data.prefs);
  };

  const pinLine = !pin.available ? "Not available right now" : !pin.set ? "Not set — needed to send or withdraw" : pin.lockedUntil ? "Locked after too many wrong tries" : "On";

  return (
    <WalletScreen label="Wallet settings">
      <SubHeader title="Wallet settings" />

      <SectionTitle>Security</SectionTitle>
      <div className={CARD}>
        <Link href="/wallet/security" prefetch={false} className={cn(ROW, "touch-manipulation active:bg-frenz-fill")}>
          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-frenz-violet/10 text-frenz-violet">
            <KeyIcon size={18} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-semibold text-frenz-ink">Transaction PIN</span>
            <span className="text-[13px] text-frenz-muted">{pinLine}</span>
          </span>
          <span className="text-[13px] font-semibold text-frenz-violet">{pin.set ? "Change or reset" : "Set up"}</span>
          <ChevronRightIcon size={16} className="text-frenz-muted" />
        </Link>
      </div>

      <SectionTitle>Notifications</SectionTitle>
      <div className={CARD}>
        <Switch label="Money in" hint="Transfers you receive and deposits that are ready" icon={<BellIcon size={18} />} on={prefs.notifyReceived} onToggle={() => void toggle("notifyReceived")} />
        <Switch label="Money out" hint="Transfers you send" icon={<BellIcon size={18} />} on={prefs.notifySent} onToggle={() => void toggle("notifySent")} />
        <Switch label="Withdrawals" hint="Requested, approved, paid or returned" icon={<BellIcon size={18} />} on={prefs.notifyWithdrawals} onToggle={() => void toggle("notifyWithdrawals")} />
      </div>
      <p className="mx-5 mt-2 text-[12px] leading-snug text-frenz-muted">
        These are push alerts. Every transaction is still listed in your activity and emailed to you as a receipt, and security alerts are always on.
      </p>

      <SectionTitle>Privacy</SectionTitle>
      <div className={CARD}>
        <Switch label="Hide my balance" hint="The wallet opens with amounts hidden. Tap the eye to show them." icon={<EyeOffIcon size={18} />} on={prefs.hideBalance} onToggle={() => void toggle("hideBalance")} />
      </div>

      {error ? (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}

      <SectionTitle>Saved bank accounts</SectionTitle>
      {banks.length ? (
        <ul className={CARD}>
          {banks.map((b) => (
            <li key={b.id} className={ROW}>
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-frenz-blue/10 text-frenz-blue">
                <BankIcon size={18} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-semibold text-frenz-ink">
                  {b.bankName} ••{b.last4}
                </span>
                {b.accountName ? <span className="truncate text-[13px] text-frenz-muted">{b.accountName}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mx-5 text-[13px] text-frenz-muted">The bank you withdraw to is saved here and offered next time.</p>
      )}

      <SectionTitle>Recent recipients</SectionTitle>
      {recipients.length ? (
        <ul className={CARD}>
          {recipients.map((r) => (
            <li key={r.id}>
              <Link href={`/wallet/transfer?to=${encodeURIComponent(r.id)}`} prefetch={false} className={cn(ROW, "touch-manipulation active:bg-frenz-fill")}>
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-frenz-magenta/10 text-frenz-magenta">
                  <UserIcon size={18} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-semibold text-frenz-ink">{r.name}</span>
                  {r.handle ? <span className="truncate text-[13px] text-frenz-muted">@{r.handle}</span> : null}
                </span>
                <span className="text-[13px] font-semibold text-frenz-violet">Send</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mx-5 pb-6 text-[13px] text-frenz-muted">People you send Frenz Coin to appear here.</p>
      )}
    </WalletScreen>
  );
}

function Switch({ label, hint, icon, on, onToggle }: { label: string; hint: string; icon: React.ReactNode; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className={cn(ROW, "w-full touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-frenz-blue")}>
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-frenz-violet/10 text-frenz-violet">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold text-frenz-ink">{label}</span>
        <span className="text-[13px] leading-snug text-frenz-muted">{hint}</span>
      </span>
      <span aria-hidden className={cn("relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 motion-reduce:transition-none", on ? "bg-frenz-violet" : "bg-frenz-line")}>
        <span className={cn("absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform duration-200 motion-reduce:transition-none", on ? "translate-x-[22px]" : "translate-x-0.5")} />
      </span>
    </button>
  );
}
