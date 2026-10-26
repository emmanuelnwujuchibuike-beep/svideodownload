"use client";

import { useMemo, useState } from "react";

import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { useStickyState } from "@/features/ui/use-sticky-state";
import { cn } from "@/lib/utils";

import { type HistoryEntry, walletApi } from "./api";
import { CoinAmount } from "./coin-amount";
import { coins, dateTimeLabel, groupByDay, releaseLabel, timeLabel } from "./money";
import { entryDirection, failMessage } from "./state";
import { useLatestRequest } from "./use-wallet-runtime";
import { ArrowUpRightIcon, BankIcon, CheckIcon, CopyIcon, DepositIcon, RefreshIcon, ReturnIcon, SendIcon } from "./wallet-icons";
import { DetailList, Notice, SessionExpired, StatusBadge } from "./wallet-ui";

type Filter = "all" | "in" | "out";

/** The row's round icon (design: Main activity rows, 40 px). */
function EntryIcon({ entry }: { entry: HistoryEntry }) {
  const dir = entryDirection(entry.kind, entry.amountCents);
  const glyph =
    entry.kind === "deposit" ? <DepositIcon size={18} /> : entry.kind === "transfer_in" ? <ArrowUpRightIcon size={18} className="rotate-180" /> : entry.kind === "transfer_out" || entry.kind === "transfer_fee" ? <SendIcon size={17} /> : entry.kind === "withdrawal" ? <BankIcon size={18} /> : entry.kind === "withdrawal_reversal" || entry.kind === "refund" ? <ReturnIcon size={18} /> : <RefreshIcon size={17} />;
  return <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", dir === "in" ? "bg-frenz-blue/10 text-frenz-blue" : "bg-frenz-fill text-frenz-ink")}>{glyph}</span>;
}

function subtitle(e: HistoryEntry): string {
  const who = e.counterparty?.name || (e.counterparty?.handle ? `@${e.counterparty.handle}` : null);
  const t = timeLabel(e.at);
  if (e.status === "pending" && e.releaseAt) return `${t} · releases ${releaseLabel(e.releaseAt)}`;
  return who ? `${who} · ${t}` : t;
}

/** One activity row: a button that opens its receipt. */
function Row({ entry, onOpen }: { entry: HistoryEntry; onOpen: (e: HistoryEntry) => void }) {
  const positive = entry.amountCents > 0;
  const quiet = entry.status === "reversed" || entry.status === "returned";
  return (
    <li>
      <button type="button" onClick={() => onOpen(entry)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left outline-none transition hover:bg-frenz-fill/70 focus-visible:ring-2 focus-visible:ring-frenz-blue active:bg-frenz-fill motion-reduce:transition-none">
        <EntryIcon entry={entry} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold text-frenz-ink">{entry.title}</span>
            {entry.status !== "completed" ? <StatusBadge status={entry.status} /> : null}
          </span>
          <span className="truncate text-[13px] text-frenz-muted">{subtitle(entry)}</span>
        </span>
        <span className={cn("shrink-0 font-heading text-[15px] font-bold", quiet ? "text-frenz-muted line-through" : positive ? "text-emerald-700 dark:text-emerald-400" : "text-frenz-ink")}>
          <CoinAmount cents={entry.amountCents} signed />
        </span>
      </button>
    </li>
  );
}

/** The receipt of one ledger entry: only what the server recorded (no invented reference). */
export function EntryReceipt({ entry, onClose }: { entry: HistoryEntry | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const ref = entry?.transferId ?? entry?.id ?? "";
  const copy = () => {
    void navigator.clipboard?.writeText(ref).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  const who = entry?.counterparty?.name || (entry?.counterparty?.handle ? `@${entry.counterparty.handle}` : null);
  return (
    <GlassSheetShell open={!!entry} onClose={onClose} title="Receipt" fitContent defaultHeightVh={80}>
      {entry ? (
        <div className="frenz-ui flex flex-col items-center gap-4 px-1 pb-8 pt-2">
          <span className="flex h-[72px] w-[72px] rounded-full bg-frenz-gradient p-[3px]">
            <span className="flex flex-1 items-center justify-center rounded-full bg-frenz-page text-frenz-violet">
              <CheckIcon size={30} strokeWidth={2.8} />
            </span>
          </span>
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-sm font-semibold text-frenz-muted">{entry.title}</span>
            <CoinAmount cents={entry.amountCents} signed className="text-[40px] font-extrabold tracking-[-1.5px] text-frenz-ink" />
            <span className="text-sm text-frenz-muted">≈ ${coins(Math.abs(entry.amountCents))} USD</span>
          </div>
          <DetailList
            className="mx-0 w-full"
            rows={[
              ["Status", <StatusBadge key="s" status={entry.status} />],
              ["Date", dateTimeLabel(entry.at)],
              ...(who ? ([[entry.kind === "transfer_in" ? "From" : "To", who]] as [string, string][]) : []),
              ...(entry.status === "pending" && entry.releaseAt ? ([["Spendable", `${dateTimeLabel(entry.releaseAt)}`]] as [string, string][]) : []),
            ]}
          />
          <div className="flex w-full items-center justify-between gap-3 rounded-[18px] border border-dashed border-frenz-line px-4 py-3">
            <span className="flex min-w-0 flex-col">
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-frenz-muted">Reference</span>
              <span className="truncate font-mono text-[13px] text-frenz-ink">{ref}</span>
            </span>
            <button type="button" onClick={copy} aria-label={copied ? "Reference copied" : "Copy reference"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-frenz-fill text-frenz-ink outline-none focus-visible:ring-2 focus-visible:ring-frenz-blue">
              {copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
            </button>
          </div>
          <span aria-live="polite" className="sr-only">
            {copied ? "Reference copied" : ""}
          </span>
        </div>
      ) : null}
    </GlassSheetShell>
  );
}

/**
 * The activity list (design: Main → Activity): filter chips, day groups, rows that open a receipt. `paged` adds "Load
 * more" — fetched only when tapped, never polled. Pages already loaded and the chosen filter survive a back-swipe
 * (useStickyState, tied to the server payload's `loadedAt`); a fresh payload starts over from it.
 */
export function ActivityList({ initial, initialNext, loadedAt, paged = false, limit }: { initial: HistoryEntry[]; initialNext: string | null; loadedAt: number; paged?: boolean; limit?: number }) {
  const scope = paged ? "all" : "recent";
  const [items, setItems] = useStickyState(`wallet-activity-items:${scope}`, loadedAt, initial);
  const [next, setNext] = useStickyState(`wallet-activity-next:${scope}`, loadedAt, initialNext);
  const [filter, setFilter] = useStickyState<Filter>(`wallet-activity-filter:${scope}`, loadedAt, "all");
  const latest = useLatestRequest();
  const [open, setOpen] = useState<HistoryEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ msg: string; expired: boolean } | null>(null);

  const shown = useMemo(() => {
    const f = filter === "all" ? items : items.filter((e) => entryDirection(e.kind, e.amountCents) === filter);
    return limit ? f.slice(0, limit) : f;
  }, [items, filter, limit]);
  const groups = useMemo(() => groupByDay(shown), [shown]);

  const more = async () => {
    if (!next || loading) return;
    setLoading(true);
    setError(null);
    const r = await latest((signal) => walletApi.history(next, 20, signal));
    if (!r) return;
    setLoading(false);
    if (!r.ok) return setError({ msg: failMessage(r, "load"), expired: r.session === "expired" });
    setItems((cur) => [...cur, ...r.data.items.filter((x) => !cur.some((c) => c.id === x.id))]);
    setNext(r.data.next);
  };

  return (
    <div className="flex flex-col">
      <div role="radiogroup" aria-label="Filter activity" className="flex gap-2 px-4 pb-2">
        {(
          [
            ["all", "All"],
            ["in", "Money in"],
            ["out", "Money out"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={filter === k}
            onClick={() => setFilter(k)}
            className={cn("h-9 rounded-full px-4 text-[13px] font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-frenz-blue motion-reduce:transition-none", filter === k ? "bg-frenz-ink text-frenz-page" : "bg-frenz-fill text-frenz-ink")}
          >
            {label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="mx-4 mt-2 rounded-[22px] bg-frenz-fill/60 px-5 py-8 text-center text-sm text-frenz-muted">{items.length === 0 ? "No activity yet. Deposits, transfers and withdrawals will show here." : "Nothing here for this filter."}</p>
      ) : (
        groups.map((g) => (
          <section key={g.label} aria-label={g.label} className="px-2">
            <h3 className="px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-[0.08em] text-frenz-muted">{g.label}</h3>
            <ul className="flex flex-col">
              {g.rows.map((e) => (
                <Row key={e.id} entry={e} onOpen={setOpen} />
              ))}
            </ul>
          </section>
        ))
      )}

      {error ? <div className="mt-3">{error.expired ? <SessionExpired next="/wallet/activity" /> : <Notice tone="error">{error.msg}</Notice>}</div> : null}

      {paged && next ? (
        <button type="button" onClick={() => void more()} disabled={loading} aria-busy={loading} className="mx-auto mt-4 h-11 rounded-full bg-frenz-fill px-6 text-sm font-bold text-frenz-ink outline-none focus-visible:ring-2 focus-visible:ring-frenz-blue disabled:opacity-60">
          {loading ? "Loading…" : "Load more"}
        </button>
      ) : null}

      <EntryReceipt entry={open} onClose={() => setOpen(null)} />
    </div>
  );
}
