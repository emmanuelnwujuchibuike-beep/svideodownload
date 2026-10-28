"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { getEntry, seed } from "@/features/data";
import { Spinner, TapPending } from "@/features/wallet/tap-pending";
import { CoinMark, Notice, PillButton, SubHeader, WalletScreen } from "@/features/wallet/wallet-ui";
import { type FgcConversionRules, previewConversion } from "@/lib/gift/conversion-rules";
import { cn } from "@/lib/utils";

import { fgcText, giftKey } from "./gift-format";
import { clearGiftReturn, giftReturn } from "./gift-prefs";

/*
  Frenz Gift Coin Part 5 — the Gift Box (design/sticker-gifts.html, screen 7 · Gift Box): the header with the balance pill,
  the gradient summary card, the Received / Sent segmented control and the day-grouped list (sticker, name, "from / to
  {name} · time", the coin amount). Every row is the gift's STORED snapshot (lib/gift/history.ts) — a sticker changed
  later never changes it. Received rows show the share earned and whether it is on hold, available or reversed.

  Beside it, the way gift earnings leave: convert available Gift Coins to Frenz Coins with the existing conversion
  engine (POST /api/gift/convert, Part 2), then withdraw from the Frenz Coin wallet as usual. There is no Gift Coin bank
  withdrawal. The preview uses the server's rules and is only a preview — the database prices the conversion again,
  and a rate changed in between is refused (expectedVersion).

  Not drawn from the design (no real figure exists for it): the summary card's "N coins in gifts" total — the card shows
  the real count and the real available / on-hold balance instead.
*/

export interface GiftBoxItem {
  id: string;
  at: string;
  conversationId: string;
  sticker: { name: string; imageUrl: string | null; rarity: string };
  amountFgc: number;
  status: "pending" | "released" | "reversed";
  holdUntil: string | null;
  other: { name: string; handle: string | null } | null;
  /** Part 6 (0296): the sender's note (first gift of its send only) and its place in that send */
  note?: string | null;
  batch?: { index: number; size: number };
}
type Tab = "received" | "sent";
type Page = { items: GiftBoxItem[]; next: string | null; counts?: { received: number | null; sent: number | null } };

/** "TODAY" / "YESTERDAY" / "12 OCT" — the design's list heads, in the member's own clock. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase();
}

export function groupByDay(items: GiftBoxItem[], now = new Date()): { label: string; items: GiftBoxItem[] }[] {
  const out: { label: string; items: GiftBoxItem[] }[] = [];
  for (const it of items) {
    const label = dayLabel(it.at, now);
    const g = out[out.length - 1];
    if (g && g.label === label) g.items.push(it);
    else out.push({ label, items: [it] });
  }
  return out;
}

type Direction = "fgc_to_fc" | "fc_to_fgc";

/** Each tab's first page lives in the app's shared cache (features/data): coming back to the Gift Box shows the last
 *  list at once, and a fresh read replaces it behind it. Later pages ("Show more") are this visit's only. */
const historyKey = (t: Tab) => `gift:history:${t}`;

export function GiftBox({ wallet, initial, counts, conversion, fc = null, initialDirection = "fgc_to_fc", back = null }: { wallet: { available: number; pending: number; nextReleaseAt: string | null } | null; initial: Page | null; counts: { received: number | null; sent: number | null }; conversion: FgcConversionRules | null; fc?: { available: number; pending: number } | null; initialDirection?: Direction; back?: string | null }) {
  // the chat a top-up started from: the URL's, or the one the gift sheet remembered for this visit (gift-prefs.ts)
  const [returnTo, setReturnTo] = useState<string | null>(back);
  useEffect(() => {
    if (!back) setReturnTo(giftReturn());
  }, [back]);
  const [tab, setTab] = useState<Tab>("received");
  const [pages, setPages] = useState<Record<Tab, Page | null>>(() => ({ received: initial ?? getEntry<Page>(historyKey("received")).data ?? null, sent: getEntry<Page>(historyKey("sent")).data ?? null }));
  useEffect(() => {
    if (initial) seed(historyKey("received"), initial);
  }, [initial]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (t: Tab, cursor: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/gift/history?box=${t}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", credentials: "same-origin" });
      const body = (await res.json().catch(() => null)) as (Page & { error?: string }) | null;
      if (!res.ok || !body) setError(body?.error ?? "Couldn't load your gifts.");
      else {
        if (!cursor) seed(historyKey(t), { items: body.items, next: body.next });
        setPages((p) => ({ ...p, [t]: cursor && p[t] ? { items: [...p[t]!.items, ...body.items], next: body.next } : { items: body.items, next: body.next } }));
      }
    } catch {
      setError("Couldn't reach the server. Check your connection.");
    }
    setLoading(false);
  };
  useEffect(() => {
    // the server rendered Received fresh; any other tab — cached or not — is read again in the background
    if (!(tab === "received" && initial)) void load(tab, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per tab
  }, [tab]);

  const page = pages[tab];
  const groups = useMemo(() => groupByDay(page?.items ?? []), [page]);
  const count = tab === "received" ? counts.received : counts.sent;

  return (
    <WalletScreen label="Gift Box">
      <SubHeader title="Gift Box" />
      <div className="flex flex-col gap-4 px-4 pt-3">
        <section aria-label={tab === "received" ? "Gifts received" : "Gifts sent"} className="flex items-center gap-3 rounded-[22px] bg-frenz-gradient-x p-[18px] text-white shadow-frenz-card">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-white/90">{tab === "received" ? "Gifts received" : "Gifts sent"}</p>
            <p className="text-[30px] font-extrabold leading-tight tracking-tight">{count ?? "—"}</p>
            {wallet ? (
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                <CoinMark size={16} />
                <span>
                  {fgcText(wallet.available)} FGC available{wallet.pending > 0 ? ` · ${fgcText(wallet.pending)} on hold` : ""}
                </span>
              </p>
            ) : null}
          </div>
        </section>
        {wallet && wallet.pending > 0 && wallet.nextReleaseAt ? <p className="-mt-2 text-[12.5px] text-frenz-muted">Gift earnings on hold become available from {new Date(wallet.nextReleaseAt).toLocaleString()}.</p> : null}

        {returnTo ? (
          <Notice title="Sending a gift?" action={<Link href={returnTo} prefetch onClick={() => clearGiftReturn()} className="font-semibold text-frenz-violet underline">Back to the chat</Link>}>
            Convert Frenz Coins to Gift Coins below, then go back to the chat to send it.
          </Notice>
        ) : null}

        <ConvertCard wallet={wallet} rules={conversion} fc={fc} initialDirection={initialDirection} returnTo={returnTo} />

        <div role="tablist" aria-label="Gift history" className="grid grid-cols-2 gap-1 rounded-[22px] border border-white bg-white/70 p-1">
          {(["received", "sent"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("h-10 rounded-[18px] text-[15px] font-semibold transition", tab === t ? "bg-white text-frenz-ink shadow-[0_2px_8px_rgba(40,24,110,0.12)]" : "text-frenz-muted")}>
              {t === "received" ? "Received" : "Sent"}
            </button>
          ))}
        </div>

        {error ? <Notice tone="error" action={<button type="button" className="font-semibold underline" onClick={() => void load(tab, null)}>Retry</button>}>{error}</Notice> : null}
        {!page && loading ? (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading gifts">
            {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[74px] animate-pulse rounded-[20px] bg-white/70" />)}
          </div>
        ) : page && page.items.length === 0 ? (
          <p className="rounded-[20px] bg-white/80 p-5 text-center text-sm text-frenz-muted">{tab === "received" ? "Gifts you receive in chats show up here." : "Gifts you send in chats show up here."}</p>
        ) : (
          <div className="flex flex-col gap-2 pb-4">
            {groups.map((g) => (
              <div key={g.label} className="flex flex-col gap-2">
                <h3 className="mx-1 mt-2 text-[13px] font-bold tracking-[0.3px] text-frenz-muted">{g.label}</h3>
                {g.items.map((it) => (
                  <Link key={it.id} href={`/messages/${it.conversationId}`} prefetch={false} className="flex items-center gap-3 rounded-[20px] border border-white bg-white/80 py-2.5 pl-2.5 pr-3.5 shadow-[0_4px_14px_rgba(40,24,110,0.05)]">
                    <span className="flex h-[54px] w-[54px] flex-none items-center justify-center rounded-2xl bg-frenz-fill">
                      {/* eslint-disable-next-line @next/next/no-img-element -- the sticker as it was when gifted (snapshot) */}
                      {it.sticker.imageUrl ? <img src={it.sticker.imageUrl} alt="" loading="lazy" className="h-[42px] w-[42px] object-contain" /> : <span aria-hidden>🎁</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">{it.sticker.name}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-frenz-muted">
                        {tab === "received" ? "from" : "to"} {it.other?.name ?? "a member"} · {new Date(it.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        {tab === "received" && it.status === "pending" && it.holdUntil ? ` · on hold until ${new Date(it.holdUntil).toLocaleDateString()}` : ""}
                        {it.status === "reversed" ? " · reversed" : ""}
                      </span>
                      {it.batch && it.batch.size > 1 ? <span className="mt-0.5 block text-[12px] font-semibold text-frenz-violet">{it.batch.index} of {it.batch.size} sent together</span> : null}
                      {/* the sender's note, as plain text (React escapes it) — on the first gift of its send */}
                      {it.note ? <span className="mt-1 block break-words rounded-xl bg-frenz-fill px-2.5 py-1.5 text-[13px] text-frenz-ink">&ldquo;{it.note}&rdquo;</span> : null}
                    </span>
                    <span className={cn("ml-auto flex items-center gap-1 text-sm font-bold", it.status === "reversed" && "text-frenz-muted line-through")}>
                      <TapPending size={15}>
                        {tab === "sent" ? "−" : ""}
                        {fgcText(it.amountFgc)}
                        <CoinMark size={15} />
                      </TapPending>
                    </span>
                  </Link>
                ))}
              </div>
            ))}
            {page?.next ? (
              <PillButton tone="ink" disabled={loading} onClick={() => void load(tab, page.next)}>
                {loading ? (
                  <>
                    <Spinner size={16} /> Loading…
                  </>
                ) : (
                  "Show more"
                )}
              </PillButton>
            ) : null}
          </div>
        )}
      </div>
    </WalletScreen>
  );
}

/** Available Gift Coins → Frenz Coins (or FC → Gift Coins), with the existing conversion engine. */
function ConvertCard({ wallet, rules, fc, initialDirection, returnTo }: { wallet: { available: number } | null; rules: FgcConversionRules | null; fc: { available: number; pending: number } | null; initialDirection: Direction; returnTo: string | null }) {
  const router = useRouter();
  const [dir, setDir] = useState<Direction>(initialDirection);
  const [converted, setConverted] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const key = useRef<{ sig: string; key: string } | null>(null);
  if (!rules) return <Notice title="Converting Gift Coins">Converting between Frenz Coins and Gift Coins isn&apos;t available yet.</Notice>;
  const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(amount);
  const minor = m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
  const preview = minor ? previewConversion(rules, dir, minor) : null;
  const inUnit = dir === "fgc_to_fc" ? "FGC" : "FC";
  const outUnit = dir === "fgc_to_fc" ? "FC" : "FGC";
  // the converter shows the real balance it draws on; the database checks it again
  const short = minor !== null && (dir === "fgc_to_fc" ? !!wallet && minor > wallet.available : !!fc && minor > fc.available);

  const convert = async () => {
    if (!preview?.ok || busy || short) return;
    const sig = `${dir}:${minor}:${rules.version}`;
    if (!key.current || key.current.sig !== sig) key.current = { sig, key: giftKey() };
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/gift/convert", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ direction: dir, amount: minor, idempotencyKey: key.current.key, expectedVersion: rules.version }) });
      const body = (await res.json().catch(() => null)) as { error?: string; net?: number; outputCurrency?: string } | null;
      setBusy(false);
      if (!res.ok) return setMsg({ kind: "error", text: body?.error ?? "Couldn't convert. Nothing was moved." });
      key.current = null;
      setAmount("");
      setMsg({ kind: "success", text: `Converted. You received ${fgcText(Number(body?.net ?? 0))} ${outUnit}.${dir === "fgc_to_fc" ? " Withdraw from your Frenz Coin wallet whenever you like." : ""}` });
      setConverted(true);
      router.refresh();
    } catch {
      setBusy(false);
      setMsg({ kind: "error", text: "Couldn't reach the server. Nothing is known to have moved — check your wallet before trying again." });
    }
  };

  return (
    <section aria-labelledby="gift-convert-title" className="rounded-[22px] border border-white bg-white/80 p-4 shadow-[0_4px_14px_rgba(40,24,110,0.05)]">
      <div className="flex items-center justify-between gap-2">
        <h2 id="gift-convert-title" className="text-[15px] font-bold">
          Convert
        </h2>
        <div role="tablist" aria-label="Conversion direction" className="flex gap-1 rounded-full bg-frenz-fill p-1 text-xs font-semibold">
          {(["fgc_to_fc", "fc_to_fgc"] as const).map((d) => (
            <button key={d} type="button" role="tab" aria-selected={dir === d} onClick={() => { setDir(d); setMsg(null); }} className={cn("rounded-full px-2.5 py-1", dir === d ? "bg-white text-frenz-ink shadow-sm" : "text-frenz-muted")}>
              {d === "fgc_to_fc" ? "Gift Coins → FC" : "FC → Gift Coins"}
            </button>
          ))}
        </div>
      </div>
      <label htmlFor="gift-convert-amount" className="mt-3 block text-[13px] font-semibold text-frenz-muted">
        Amount ({inUnit})
      </label>
      <input id="gift-convert-amount" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setMsg(null); }} placeholder="0.00" className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-base" />
      <p className="mt-1.5 min-h-[1.2rem] text-[13px] text-frenz-muted" aria-live="polite">
        {!amount ? (dir === "fgc_to_fc" ? "Only available Gift Coins convert — gift earnings on hold don't." : fc ? `You have ${fgcText(fc.available)} FC available.` : "") : !preview ? "Up to 2 decimals." : !preview.ok ? (preview.reason === "below_fee" ? "Too small to cover the fee." : `From ${fgcText(preview.min)} to ${fgcText(preview.max)} ${inUnit}.`) : short ? (dir === "fgc_to_fc" ? "More than your available Gift Coins." : "More than your available Frenz Coins.") : `You get ${fgcText(preview.net)} ${outUnit} (fee ${fgcText(preview.fee)} ${outUnit}).`}
      </p>
      {dir === "fc_to_fgc" && fc && fc.pending > 0 ? (
        <p className="text-[12.5px] text-frenz-muted">{fgcText(fc.pending)} FC from deposits is still pending — it can be converted once it settles.</p>
      ) : null}
      {dir === "fc_to_fgc" && fc && fc.available === 0 ? (
        <p className="mt-1 text-[12.5px] text-frenz-muted">
          No Frenz Coins to convert yet.{" "}
          <Link href="/wallet/deposit" prefetch className="font-semibold text-frenz-violet underline">
            Add Frenz Coins
          </Link>{" "}
          first — the payment is confirmed before they appear here.
        </p>
      ) : null}
      {msg ? <Notice tone={msg.kind === "success" ? "success" : "error"} className="mt-2">{msg.text}</Notice> : null}
      {converted && returnTo && dir === "fc_to_fgc" ? (
        <Link href={returnTo} prefetch onClick={() => clearGiftReturn()} className="mt-2 flex h-11 items-center justify-center rounded-full bg-frenz-fill text-sm font-semibold">
          Back to the chat to send your gift
        </Link>
      ) : null}
      <PillButton className="mt-3 w-full" disabled={busy || !preview?.ok || !!short} aria-busy={busy} onClick={() => void convert()}>
        {busy ? (
          <>
            <Spinner size={16} /> Converting…
          </>
        ) : (
          `Convert to ${outUnit === "FC" ? "Frenz Coins" : "Gift Coins"}`
        )}
      </PillButton>
      {dir === "fgc_to_fc" ? (
        <p className="mt-2 text-[12.5px] text-frenz-muted">
          Gift Coins aren&apos;t paid to a bank directly. Convert them to Frenz Coins, then{" "}
          <Link href="/wallet/withdraw" className="inline-flex items-center gap-1 font-semibold text-frenz-violet underline">
            <TapPending size={13}>withdraw from your wallet</TapPending>
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}
