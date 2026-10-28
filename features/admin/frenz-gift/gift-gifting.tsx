"use client";

import { useEffect, useMemo, useState } from "react";

import type { GiftingRules } from "@/lib/gift/gifting-rules";

import { postMoney, useAdminRead } from "../frenz-coin/coin-admin-data";
import { Badge, BTN, Card, Empty, Field, INPUT, Message, when } from "../frenz-coin/coin-admin-ui";
import { formFromGifting, type GiftingForm, readGiftingForm } from "./gift-admin-logic";

type SensitiveFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;
type Read = { gifting: GiftingRules | null; problem: string | null; updatedAt: string | null };
type PendingGift = { id: string; senderId: string; recipientId: string; priceFgc: number; recipientShare: number; commission: number; holdUntil: string; stickerName: string; createdAt: string };

const fgc = (minor: number) => `${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} FGC`;
const pct = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.00$/, "")}%`;

/**
 * Admin → Frenz Coin → Gift Coin → Sticker gifting (Frenz Gift Coin Part 4). The recipient's share (the commission is the
 * rest, exactly 100% together), how long earnings are held, the deposit cooldown (the chargeback guard: gifts can't be
 * traced to a deposit) and the daily gifting limit. Saved through /api/admin/gift/gifting (a fresh password, checked
 * again by the database, version-checked, audited). Empty until saved — gifting is off until then.
 */
export function GiftGifting({ sensitiveFetch }: { sensitiveFetch: SensitiveFetch }) {
  const read = useAdminRead<Read>("/api/admin/gift/gifting");
  const stored = read.data?.gifting ?? null;
  const [form, setForm] = useState<GiftingForm>(() => formFromGifting(null));
  const [loaded, setLoaded] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!read.data) return;
    const v = read.data.gifting?.version ?? 0;
    if (loaded !== v) {
      setForm(formFromGifting(read.data.gifting));
      setLoaded(v);
    }
  }, [read.data, loaded]);

  const version = stored?.version ?? 0;
  const result = useMemo(() => readGiftingForm(form, version), [form, version]);
  const dirty = JSON.stringify(form) !== JSON.stringify(formFromGifting(stored));
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (k: keyof GiftingForm, v: string) => {
    setMsg(null);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const save = async () => {
    if (!result.ok || !dirty || busy) return;
    setBusy(true);
    setMsg(null);
    const r = await postMoney<{ unchanged: boolean; version: number }>(sensitiveFetch, "/api/admin/gift/gifting", { ...result.fields, expectedVersion: version });
    setBusy(false);
    if (!r.ok) {
      if (r.reason === "stale") await read.reload();
      return setMsg({ kind: "error", text: r.error });
    }
    await read.reload();
    setMsg({ kind: "ok", text: r.data.unchanged ? "Nothing changed." : `Saved as version ${r.data.version}. Recorded in the audit log.` });
  };

  if (read.loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (read.error && !read.data) return <Message kind="error">{read.error}</Message>;
  const errs = result.ok ? {} : result.fields;
  const share = result.ok ? result.fields.recipientShareBp : null;

  return (
    <div className="space-y-5">
      <Card title="Sticker gifting" action={<span className="flex items-center gap-2 text-xs text-muted-foreground">{stored ? <Badge tone="green">Configured · version {stored.version}</Badge> : <Badge tone="amber">Not configured — gifting is off</Badge>}{read.data?.updatedAt ? `changed ${when(read.data.updatedAt)}` : null}</span>}>
        {read.data?.problem ? <div className="mb-3"><Message kind="error">The stored gifting rules can&apos;t be used, so gifts are refused: {read.data.problem}</Message></div> : null}
        <p className="mb-3 text-xs text-muted-foreground">
          The sender pays the sticker&apos;s price in Gift Coins. The recipient earns their share as pending Gift Coins, available after the hold; they can then convert them to Frenz Coins and withdraw through the usual Frenz Coin withdrawal. The platform keeps the commission (the recipient&apos;s share is rounded down to the cent).
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field htmlFor="gg-share" label="Recipient's share (%)" hint={share !== null ? `Commission: ${pct(10_000 - share)} (together exactly 100%)` : "Up to 2 decimals; the commission is the rest"} error={errs.sharePercent}>
            <input id="gg-share" inputMode="decimal" className={INPUT} value={form.sharePercent} onChange={(e) => set("sharePercent", e.target.value)} />
          </Field>
          <Field htmlFor="gg-hold" label="Earnings hold (hours)" hint="1 to 2160. Pending until it ends." error={errs.holdHours}>
            <input id="gg-hold" inputMode="numeric" className={INPUT} value={form.holdHours} onChange={(e) => set("holdHours", e.target.value)} />
          </Field>
          <Field htmlFor="gg-cool" label="Deposit cooldown (hours)" hint="0 to 2160. No gifting this long after a deposit." error={errs.cooldownHours}>
            <input id="gg-cool" inputMode="numeric" className={INPUT} value={form.cooldownHours} onChange={(e) => set("cooldownHours", e.target.value)} />
          </Field>
          <Field htmlFor="gg-daily" label="Daily gifting limit (FGC)" hint="Per member, rolling 24 hours" error={errs.dailyMax}>
            <input id="gg-daily" inputMode="decimal" className={INPUT} value={form.dailyMax} onChange={(e) => set("dailyMax", e.target.value)} />
          </Field>
        </div>
        {!result.ok && result.message ? <div className="mt-3"><Message kind="error">{result.message}</Message></div> : null}
        {msg ? <div className="mt-3"><Message kind={msg.kind}>{msg.text}</Message></div> : null}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{dirty ? (result.ok ? "Unsaved changes" : "Fix the rules before saving") : "No changes"} · saving asks for your password</span>
          <div className="flex gap-2">
            <button type="button" className={`${BTN} border border-border`} disabled={busy || !dirty} onClick={() => { setForm(formFromGifting(stored)); setMsg(null); }}>
              Discard
            </button>
            <button type="button" className={`${BTN} bg-foreground text-background`} disabled={busy || !dirty || !result.ok} aria-busy={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save gifting rules"}
            </button>
          </div>
        </div>
      </Card>
      <GiftReview sensitiveFetch={sensitiveFetch} />
    </div>
  );
}

/** Pending gifts — those past their hold are waiting on a sender under review (or the next wallet read). Reverse = a chargeback decision. */
function GiftReview({ sensitiveFetch }: { sensitiveFetch: SensitiveFetch }) {
  const list = useAdminRead<{ gifts: PendingGift[] }>("/api/admin/gift/gifts");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const reverse = async (g: PendingGift) => {
    const reason = window.prompt(`Reverse the ${g.stickerName} gift (${fgc(g.priceFgc)})? The recipient's pending ${fgc(g.recipientShare)} is taken back and the sender is refunded. Reason:`);
    if (!reason?.trim()) return;
    setBusy(g.id);
    const r = await postMoney<{ duplicate: boolean }>(sensitiveFetch, "/api/admin/gift/gifts", { giftId: g.id, reason: reason.trim() });
    setBusy(null);
    setMsg(r.ok ? { kind: "ok", text: "Gift reversed. Recorded in the audit log." } : { kind: "error", text: r.error });
    await list.reload();
  };
  const now = Date.now();
  return (
    <Card title="Pending gift earnings" action={<button type="button" className={`${BTN} border border-border`} onClick={() => void list.reload()} disabled={list.refreshing}>{list.refreshing ? "Refreshing…" : "Refresh"}</button>}>
      <p className="mb-3 text-xs text-muted-foreground">A gift whose hold has passed but is still pending is waiting on a sender under financial review (a restriction, a recovery, a disputed deposit). Reversing returns the recipient&apos;s pending share and refunds the sender. Released earnings are never reversed here.</p>
      {msg ? <div className="mb-3"><Message kind={msg.kind}>{msg.text}</Message></div> : null}
      {list.loading ? <p className="text-sm text-muted-foreground">Loading…</p> : list.error && !list.data ? <Message kind="error">{list.error}</Message> : !list.data?.gifts.length ? <Empty>No pending gifts.</Empty> : (
        <ul className="divide-y divide-border text-sm">
          {list.data.gifts.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{g.stickerName}</span> · {fgc(g.priceFgc)} · earns {fgc(g.recipientShare)}
                <span className="block text-xs text-muted-foreground">sent {when(g.createdAt)} · hold until {when(g.holdUntil)}</span>
              </span>
              {new Date(g.holdUntil).getTime() <= now ? <Badge tone="amber">hold passed — under review</Badge> : <Badge tone="gray">on hold</Badge>}
              <button type="button" className={`${BTN} border border-border`} disabled={busy === g.id} onClick={() => void reverse(g)}>
                {busy === g.id ? "Reversing…" : "Reverse"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
