"use client";

import { ArrowDownLeft, ArrowUpRight, Copy, Send } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { toast } from "@/features/ui/toast";
import { formatCredits } from "@/lib/ai/credits/units";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

const GlassSheetShell = dynamic(() => import("@/features/ui/glass-sheet-shell").then((m) => m.GlassSheetShell), { ssr: false });

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  SEND & RECEIVE CREDITS — the wallet number, the Send button, the history
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: "users can transfer credits to another user with a user
 * account number … a charge of 5%" and "add the transfer button and transfer
 * history in the dashboard".
 *
 * Two reads when the card appears (the number, the last transfers). The send
 * sheet confirms WHO a number belongs to before anything moves, shows the fee
 * and the total, and sends one idempotency key per transfer attempt — minted
 * when the sheet opens, not per tap, so a double tap or a retry after a lost
 * answer is the same transfer, never a second one. Every number shown is a
 * preview; the server re-decides all of it.
 *
 * 0199 (owner, 2026-10-08): the sender chooses WHICH credits to send —
 * non-withdrawable or withdrawable — and the recipient receives the same kind.
 * The amount and the fee come only from the chosen kind.
 */
export interface TransferRules {
  feePercent: number;
  minCredits: number;
  maxCredits: number;
  dailyMaxCredits: number;
}

export type TransferKind = "usable" | "withdrawable";

const KIND_LABEL: Record<TransferKind, string> = { usable: "Non-withdrawable", withdrawable: "Withdrawable" };

interface TransferRow {
  id: string;
  direction: "sent" | "received";
  amount: number;
  fee: number;
  kind?: TransferKind;
  with: string;
  note: string | null;
  at: string;
}

function newKey(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
}

/*
  Cache-first (owner, 2026-10-07: "pages cache and revalidate when there is new
  data — back-swipe or re-entry should never load"). The number never changes
  and the history changes only when the balance does, so both are kept for the
  session and painted at once; the history is re-read only when the balance the
  page shows has moved (a transfer in or out) or the kept copy is old.
*/
const KEEP_KEY = "frenz:wallet-transfers:v1";
const HIDE_KEY = "frenz:wallet-transfers:hidden";
const HISTORY_STALE_MS = 5 * 60_000;
let kept: { account: string | null; history: TransferRow[] | null; at: number; balance: number | null } | null = null;
function readKept() {
  if (kept) return kept;
  try {
    const raw = sessionStorage.getItem(KEEP_KEY);
    if (raw) kept = JSON.parse(raw) as typeof kept;
  } catch {
    /* no storage */
  }
  return kept;
}
function writeKept(patch: Partial<NonNullable<typeof kept>>) {
  kept = { account: null, history: null, at: 0, balance: null, ...(kept ?? {}), ...patch };
  try {
    sessionStorage.setItem(KEEP_KEY, JSON.stringify(kept));
  } catch {
    /* fine */
  }
}

const feeOf = (amount: number, pct: number) => (amount > 0 && pct > 0 ? Math.ceil((Math.floor(amount) * pct) / 100) : 0);

export function TransferPanel({ rules, balance, withdrawable = null, onChanged, className }: { rules: TransferRules | null; balance: number | null; withdrawable?: number | null; onChanged: () => void; className?: string }) {
  const [account, setAccount] = useState<string | null>(null);
  const [history, setHistory] = useState<TransferRow[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [historyHidden, setHistoryHidden] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const loadHistory = useCallback(async () => {
    const r = await fetch("/api/ai/wallet/transfers", { cache: "no-store" }).catch(() => null);
    if (r?.ok) {
      const next = ((await r.json()) as { transfers: TransferRow[] }).transfers;
      // only a real change touches the screen
      setHistory((h) => (h && JSON.stringify(h) === JSON.stringify(next) ? h : next));
      writeKept({ history: next, at: Date.now(), balance });
    } else setHistory((h) => h ?? []);
  }, [balance]);

  // paint the kept copy before the browser shows a frame (no skeleton on re-entry)
  useLayoutEffect(() => {
    try {
      setHistoryHidden(localStorage.getItem(HIDE_KEY) === "1");
    } catch {
      /* no storage — shown */
    }
    const k = readKept();
    if (k?.account) setAccount(k.account);
    if (k?.history) setHistory(k.history);
  }, []);

  // the number is re-confirmed quietly once per visit — a different account in this tab (sign-out, sign-in) drops the kept copy
  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/ai/wallet/account", { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return;
      const accountNumber = ((await r.json()) as { accountNumber: string }).accountNumber;
      const k = readKept();
      if (k?.account && k.account !== accountNumber) {
        writeKept({ account: accountNumber, history: null, at: 0, balance: null });
        setHistory(null);
        void loadHistory();
      } else writeKept({ account: accountNumber });
      setAccount(accountNumber);
    })();
    // once per visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the history is re-read only when it can have changed: the balance moved, or the copy is old
  useEffect(() => {
    const k = readKept();
    const moved = balance !== null && k?.balance !== null && k?.balance !== undefined && k.balance !== balance;
    if (historyHidden) return; // hidden: nothing is read until it is shown again
    if (!k?.history || moved || Date.now() - (k?.at ?? 0) > HISTORY_STALE_MS) void loadHistory();
  }, [balance, loadHistory, historyHidden]);

  const copy = async () => {
    if (!account) return;
    haptic("selection");
    try {
      await navigator.clipboard.writeText(account);
      toast("Wallet number copied.", "success");
    } catch {
      toast("Couldn't copy it.", "error");
    }
  };

  const shown = history ? (showAll ? history : history.slice(0, 5)) : null;

  return (
    <section aria-label="Send and receive credits" className={cn("rounded-2xl bg-card/95 p-4 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Your wallet number</p>
          <p className="mt-0.5 font-mono text-[19px] font-bold tabular-nums tracking-[0.06em]">{account ? `${account.slice(0, 3)} ${account.slice(3, 6)} ${account.slice(6)}` : "··· ··· ····"}</p>
          <p className="text-[11.5px] text-muted-foreground">Share it to receive credits.</p>
        </div>
        <button type="button" onClick={() => void copy()} disabled={!account} className="inline-flex min-h-[2.75rem] shrink-0 items-center gap-1.5 rounded-full bg-secondary px-3.5 text-[13px] font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
          <Copy className="h-4 w-4" aria-hidden />
          Copy
        </button>
      </div>

      {rules ? (
        <button
          type="button"
          onClick={() => {
            haptic("selection");
            setSheetOpen(true);
          }}
          className="mt-3 inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 text-[14.5px] font-semibold text-white shadow-[0_12px_28px_-16px_rgb(79_70_229/0.9)] transition active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 motion-reduce:active:scale-100"
        >
          <Send className="h-4 w-4" aria-hidden />
          Send credits
        </button>
      ) : (
        <p className="mt-3 text-[12.5px] text-muted-foreground">Sending credits isn&apos;t available right now.</p>
      )}

      {/* 2026-10-07 (owner): the history can be hidden, so a long list never weighs on the page — remembered per device */}
      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Transfer history</h3>
        <button
          type="button"
          onClick={() => {
            const next = !historyHidden;
            setHistoryHidden(next);
            try {
              localStorage.setItem(HIDE_KEY, next ? "1" : "0");
            } catch {
              /* fine */
            }
          }}
          aria-expanded={!historyHidden}
          className="text-[12.5px] font-semibold text-indigo-700"
        >
          {historyHidden ? "Show" : "Hide"}
        </button>
      </div>
      {historyHidden ? null : shown === null ? (
        <div className="mt-2 h-14 animate-pulse rounded-xl bg-secondary/60 motion-reduce:animate-none" aria-busy="true" aria-label="Loading transfers" />
      ) : shown.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-muted-foreground">No transfers yet.</p>
      ) : (
        <>
          <ul className="mt-1 divide-y divide-border/60">
            {shown.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", t.direction === "received" ? "bg-emerald-500/12 text-emerald-600" : "bg-indigo-500/10 text-indigo-600")}>
                  {t.direction === "received" ? <ArrowDownLeft className="h-4 w-4" aria-hidden /> : <ArrowUpRight className="h-4 w-4" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{t.direction === "received" ? `From ${t.with}` : `To ${t.with}`}</p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {new Date(t.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                    {t.kind === "withdrawable" ? " · withdrawable" : ""}
                    {t.fee ? ` · ${formatCredits(t.fee)} fee` : ""}
                    {t.note ? ` · ${t.note}` : ""}
                  </p>
                </div>
                <span className={cn("shrink-0 text-[14px] font-semibold tabular-nums", t.direction === "received" ? "text-emerald-600" : "text-foreground")}>
                  {t.direction === "received" ? "+" : "−"}
                  {formatCredits(t.amount)}
                </span>
              </li>
            ))}
          </ul>
          {history && history.length > 5 ? (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-1 text-[12.5px] font-semibold text-indigo-700">
              {showAll ? "Show less" : `Show all ${history.length}`}
            </button>
          ) : null}
        </>
      )}

      {rules && sheetOpen ? (
        <SendSheet
          rules={rules}
          balance={balance}
          withdrawable={withdrawable}
          onClose={() => setSheetOpen(false)}
          onSent={() => {
            setSheetOpen(false);
            onChanged();
            void loadHistory();
          }}
        />
      ) : null}
    </section>
  );
}

/** A member chosen elsewhere (a chat): no number to type — the server resolves their wallet. */
export interface PresetRecipient {
  userId: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

export function SendSheet({
  rules,
  balance,
  withdrawable = null,
  onClose,
  onSent,
  recipient = null,
}: {
  rules: TransferRules;
  balance: number | null;
  /** The withdrawable part of `balance`; null when unknown (the server still decides). */
  withdrawable?: number | null;
  onClose: () => void;
  onSent: () => void;
  recipient?: PresetRecipient | null;
}) {
  const [number, setNumber] = useState("");
  const [who, setWho] = useState<{ name: string; handle: string | null; avatarUrl: string | null } | null>(recipient ? { name: recipient.name, handle: recipient.handle, avatarUrl: recipient.avatarUrl } : null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<TransferKind>("usable");
  const [busy, setBusy] = useState<"lookup" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ONE key per transfer attempt (minted when the sheet opens) — a retry is the same transfer
  const key = useRef(newKey());

  const n = Number(amount);
  const fee = feeOf(n, rules.feePercent);
  const total = Number.isInteger(n) && n > 0 ? n + fee : 0;
  const amountOk = Number.isInteger(n) && n >= rules.minCredits && n <= rules.maxCredits;
  // only the chosen kind pays the amount and the fee
  const available = balance === null ? null : withdrawable === null ? (kind === "usable" ? balance : null) : kind === "withdrawable" ? withdrawable : Math.max(0, balance - withdrawable);
  const enough = available === null || total <= available;

  async function lookup() {
    const num = number.replace(/\s+/g, "");
    if (!/^[1-9][0-9]{9}$/.test(num) || busy) return setError(num ? "Enter a 10-digit wallet number." : null);
    setBusy("lookup");
    setError(null);
    try {
      const r = await fetch(`/api/ai/wallet/transfer/lookup?number=${encodeURIComponent(num)}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { name?: string; handle?: string | null; avatarUrl?: string | null; error?: string };
      if (!r.ok || !j.name) setError(j.error ?? "No wallet has that number.");
      else setWho({ name: j.name, handle: j.handle ?? null, avatarUrl: j.avatarUrl ?? null });
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!who || !amountOk || !enough || busy) return;
    setBusy("send");
    setError(null);
    haptic("medium");
    try {
      const r = await fetch("/api/ai/wallet/transfer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(recipient ? { recipientUserId: recipient.userId } : { accountNumber: number.replace(/\s+/g, "") }), credits: n, kind, idempotencyKey: key.current, note: note.trim() || null }),
      });
      const j = (await r.json().catch(() => ({}))) as { amount?: number; fee?: number; error?: string };
      if (!r.ok) {
        setError(j.error ?? "Couldn't send that.");
        return;
      }
      toast(`Sent ${formatCredits(j.amount ?? n)}${kind === "withdrawable" ? " withdrawable" : ""} to ${who.name}.`, "success");
      key.current = newKey();
      onSent();
    } catch {
      setError("Network error — your transfer may still go through. Check your history before trying again.");
    } finally {
      setBusy(null);
    }
  }

  const field = "mt-1 h-12 w-full rounded-2xl border border-border/70 bg-background px-4 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400";
  return (
    <GlassSheetShell open onClose={onClose} title="Send credits" fitContent defaultHeightVh={78}>
      <div className="px-4 pb-6">
        {!who ? (
          <>
            <label className="block text-[13px] font-semibold">
              Wallet number
              <input inputMode="numeric" autoComplete="off" maxLength={12} value={number} onChange={(e) => setNumber(e.target.value.replace(/[^\d ]/g, ""))} placeholder="10 digits" className={cn(field, "font-mono tracking-[0.08em]")} />
            </label>
            <button type="button" onClick={() => void lookup()} disabled={busy !== null} className="mt-3 inline-flex min-h-[3rem] w-full items-center justify-center rounded-full bg-foreground text-[14.5px] font-semibold text-background disabled:opacity-50">
              {busy === "lookup" ? "Checking…" : "Continue"}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 px-3 py-2.5">
              {who.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={who.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-500 font-bold text-white">{who.name.replace("@", "").charAt(0).toUpperCase()}</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{who.name}</p>
                <p className="truncate text-[12px] text-muted-foreground">
                  {who.handle ? `@${who.handle}` : ""}
                  {recipient ? "" : `${who.handle ? " · " : ""}wallet ${number.replace(/\s+/g, "").slice(-4).padStart(10, "•")}`}
                </p>
              </div>
              {recipient ? null : (
                <button type="button" onClick={() => setWho(null)} className="text-[12.5px] font-semibold text-indigo-700">
                  Change
                </button>
              )}
            </div>
            <fieldset className="mt-4">
              <legend className="text-[13px] font-semibold">Which credits</legend>
              <div role="radiogroup" aria-label="Which credits to send" className="mt-1 grid grid-cols-2 gap-2">
                {(["usable", "withdrawable"] as const).map((k) => {
                  const have = balance === null ? null : withdrawable === null ? (k === "usable" ? balance : null) : k === "withdrawable" ? withdrawable : Math.max(0, balance - withdrawable);
                  const on = kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        haptic("selection");
                        setKind(k);
                        setError(null);
                      }}
                      className={cn(
                        "min-h-[3.25rem] rounded-2xl px-3 py-2 text-left ring-1 ring-inset transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
                        on ? "bg-indigo-500/10 ring-indigo-500" : "bg-background ring-border/70",
                      )}
                    >
                      <span className={cn("block text-[13px] font-semibold", on ? "text-indigo-700 dark:text-indigo-300" : "")}>{KIND_LABEL[k]}</span>
                      <span className="block text-[11.5px] tabular-nums text-muted-foreground">{have === null ? "—" : `${formatCredits(have)} available`}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <label className="mt-4 block text-[13px] font-semibold">
              Credits to send
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder={`${rules.minCredits}–${rules.maxCredits.toLocaleString("en-US")}`} className={cn(field, "font-bold tabular-nums")} />
            </label>
            <dl className="mt-2 space-y-1 text-[13px]">
              <div className="flex justify-between"><dt className="text-muted-foreground">Transfer fee ({rules.feePercent}%)</dt><dd className="tabular-nums">{formatCredits(fee)}</dd></div>
              <div className="flex justify-between font-semibold"><dt>Total ({KIND_LABEL[kind].toLowerCase()})</dt><dd className="tabular-nums">{formatCredits(total)}</dd></div>
              {available !== null ? <div className="flex justify-between text-muted-foreground"><dt>{KIND_LABEL[kind]} available</dt><dd className="tabular-nums">{formatCredits(available)}</dd></div> : null}
            </dl>
            <label className="mt-3 block text-[13px] font-semibold">
              Note <span className="font-normal text-muted-foreground">(optional)</span>
              <input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} className={field} />
            </label>
            <p className="mt-2 text-[11.5px] text-muted-foreground">{who.name} receives the full amount as {kind === "withdrawable" ? "withdrawable" : "non-withdrawable"} credits. Transfers can&apos;t be undone.</p>
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy !== null || !amountOk || !enough}
              className="mt-3 inline-flex min-h-[3rem] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 text-[15px] font-bold text-white disabled:opacity-45"
            >
              <Send className="h-4 w-4" aria-hidden />
              {busy === "send" ? "Sending…" : amountOk ? `Send ${formatCredits(n)}` : "Enter an amount"}
            </button>
            {amount && !amountOk ? <p className="mt-2 text-[12px] text-muted-foreground">Between {rules.minCredits} and {rules.maxCredits.toLocaleString("en-US")} credits per transfer.</p> : null}
            {amountOk && !enough ? <p className="mt-2 text-[12px] font-semibold text-rose-600">Not enough {KIND_LABEL[kind].toLowerCase()} credits for this amount plus the fee.</p> : null}
          </>
        )}
        {error ? (
          <p role="alert" className="mt-3 text-[12.5px] font-semibold text-rose-600">
            {error}
          </p>
        ) : null}
      </div>
    </GlassSheetShell>
  );
}
