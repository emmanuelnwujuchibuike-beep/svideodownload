"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getEntry, revalidate, useQuery } from "@/features/data";
import { GlassSheetShell } from "@/features/ui/glass-sheet-shell";
import { toast } from "@/features/ui/toast";
import { Spinner } from "@/features/wallet/tap-pending";
import { GIFT_BATCH_MAX, GIFT_NOTE_MAX, giftTotal, normalizeGiftNote, noteLength } from "@/lib/gift/batch";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

import { categoriesOf, fgcText, giftFailureText, giftKey, RARITY_TAG, type Rarity } from "./gift-format";
import { confirmSkipped, dismissCoach, rememberGiftReturn, skipConfirmForAWeek } from "./gift-prefs";

/*
  Frenz Gift Coin — the sticker gallery (design/sticker-gifts.html screen 2), the gift detail (screen 3) and the top-up
  route (screen 6), opened from the chat composer.

  One read when it opens (/api/gift/gallery: the published stickers, the FGC wallet with due earnings released, whether
  gifting is configured). Nothing financial is decided here: the unit price shown is the server's, the send carries the
  revision and unit price the member SAW plus the quantity, and the database multiplies, checks the WHOLE batch against
  the available balance and the daily limit, and refuses if anything changed (sticker_changed — the new price is shown
  and must be confirmed again). The idempotency key is made once per intended send (sticker, price, quantity, note,
  recipient) and reused on retry, so a retry can never send twice.

  Part 6 (owner, 2026-10-27): no PIN — "they send a gift like a normal sticker". Instead the first send asks "are you
  sure?", with the choice to skip that question for a week (gift-prefs.ts). No Price / Available / Total / Balance-after rows any more (owner, 2026-10-28: "remove this calculation … I don't want the
  gift card to be scrollable"): the total rides on the Send button, the balance on its pill, and the stage is compact so the
  whole card fits without a scroll.
*/

export interface GiftRecipient {
  userId: string;
  name: string;
  avatarUrl: string | null;
}
interface Sticker {
  id: string;
  revision: number;
  name: string;
  description: string | null;
  rarity: Rarity;
  category: string | null;
  featured: boolean;
  priceFgc: number;
  imageUrl: string | null;
  animationUrl: string | null;
}
interface Gallery {
  stickers: Sticker[];
  wallet: { available: number; pending: number; nextReleaseAt: string | null };
  giftingReady: boolean;
}

/**
 * The gallery through the app's shared cache (features/data): reopening the sheet paints the stickers and balance at
 * once from the last read, while a fresh read replaces them behind it. The balance shown is always replaced by the
 * server's; the database decides every send whatever the cached figure said.
 */
export const GIFT_GALLERY_KEY = "gift:gallery";

/** Fill the shared cache with the sticker gallery before the sheet opens (the story reply bar calls it). Fails quietly. */
export function warmGiftSheet(): void {
  if (getEntry(GIFT_GALLERY_KEY).data) return;
  void revalidate(GIFT_GALLERY_KEY, fetchGallery).catch(() => {});
}
async function fetchGallery(): Promise<Gallery> {
  let res: Response;
  try {
    res = await fetch("/api/gift/gallery", { cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection.");
  }
  const body = (await res.json().catch(() => null)) as (Gallery & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? "Couldn't load the stickers.");
  return body;
}

/**
 * `conversationId`: the chat the gift lands in — or, from a story (2026-10-28), a function that finds or creates the 1:1
 * chat with its author, called only when Send is pressed (opening the sheet never creates a chat). `backHref`: where the
 * top-up screens return to (the chat, unless given).
 */
export function GiftSheet({ conversationId = null, place = null, recipients, requireChoice, onClose, onSent, initialStickerId, backHref, zIndex }: { conversationId?: string | (() => Promise<string>) | null; /** 0304: a gift from a post goes on the post (its comments), never into a chat */ place?: { kind: "post" | "sub_post"; id: string } | null; recipients: GiftRecipient[]; requireChoice: boolean; onClose: () => void; onSent: () => void; initialStickerId?: string | null; backHref?: string; zIndex?: number }) {
  const [resolvedId, setResolvedId] = useState<string | null>(typeof conversationId === "string" ? conversationId : null);
  const gallery = useQuery<Gallery>(GIFT_GALLERY_KEY, fetchGallery, { revalidateOnFocus: false });
  const data = gallery.data ?? null;
  // an error only matters when there is nothing cached to show
  const loadError = !data && gallery.error ? (gallery.error instanceof Error ? gallery.error.message : "Couldn't load the stickers.") : null;
  const [category, setCategory] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Sticker | null>(null);
  const [recipient, setRecipient] = useState<GiftRecipient | null>(requireChoice ? null : (recipients[0] ?? null));
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [skipWeek, setSkipWeek] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<{ sig: string; key: string } | null>(null);

  const refetchGallery = gallery.refetch;
  const load = useCallback(() => refetchGallery().catch(() => undefined), [refetchGallery]);
  // "Send one back" from the reveal opens straight on that sticker, if it is still in the catalogue
  useEffect(() => {
    if (!initialStickerId || !data || chosen) return;
    const s = data.stickers.find((x) => x.id === initialStickerId);
    if (s) setChosen(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the gallery arrives
  }, [data, initialStickerId]);

  const cats = useMemo(() => categoriesOf(data?.stickers ?? []), [data]);
  /*
    The grid's play (owner, 2026-10-28: "animated one at a time starting from the first to the last, or any one the user
    hovers"): the turn moves every 3 s — the length of one play — and a hovered or focused sticker takes over.
  */
  const [turn, setTurn] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setInterval(() => setTurn((n) => n + 1), 3000);
    return () => window.clearInterval(t);
  }, []);
  const shown = useMemo(() => (data?.stickers ?? []).filter((s) => !category || s.category === category), [data, category]);
  const featured = useMemo(() => (data?.stickers ?? []).find((s) => s.featured) ?? null, [data]);
  const available = data?.wallet.available ?? 0;
  const total = chosen ? giftTotal(chosen.priceFgc, quantity) : 0;
  const short = !!chosen && total > available;
  const noteCheck = normalizeGiftNote(note);
  const noteChars = noteLength(note.trim());

  const pick = (s: Sticker) => {
    haptic("selection");
    setChosen(s);
    setQuantity(1);
    setError(null);
    setConfirming(false);
  };
  const back = () => {
    setChosen(null);
    setError(null);
    setConfirming(false);
  };

  const send = async () => {
    if (!chosen || !recipient || sending || short || !noteCheck.ok) return;
    const sig = `${place ? `${place.kind}:${place.id}` : (resolvedId ?? "story")}:${recipient.userId}:${chosen.id}:${chosen.revision}:${chosen.priceFgc}:${quantity}:${noteCheck.note ?? ""}`;
    if (!key.current || key.current.sig !== sig) key.current = { sig, key: giftKey() };
    setSending(true);
    setError(null);
    let res: Response;
    let chatId = resolvedId;
    try {
      if (!place && !chatId && typeof conversationId === "function") {
        try {
          chatId = await conversationId();
          setResolvedId(chatId);
        } catch (e) {
          setSending(false);
          setConfirming(false);
          return setError(e instanceof Error && e.message ? e.message : giftFailureText("network", null));
        }
      }
      res = await fetch("/api/gift/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...(place ? { place } : { conversationId: chatId }), recipientId: requireChoice ? recipient.userId : null, stickerId: chosen.id, expectedRevision: chosen.revision, expectedPriceFgc: chosen.priceFgc, quantity, note: noteCheck.note, idempotencyKey: key.current.key }),
      });
    } catch {
      setSending(false);
      setConfirming(false);
      return setError(giftFailureText("network", null));
    }
    const body = (await res.json().catch(() => null)) as { error?: string; reason?: string; current?: { revision: number; priceFgc: number }; totalFgc?: number; quantity?: number; balanceAfter?: number | null } | null;
    setSending(false);
    setConfirming(false);
    if (!res.ok) {
      haptic("light");
      if (body?.reason === "sticker_changed" && body.current) {
        // the server's current price replaces what was shown: the member confirms again (a new key for the new price)
        setChosen({ ...chosen, revision: body.current.revision, priceFgc: body.current.priceFgc });
        key.current = null;
      }
      if (body?.reason === "sticker_unavailable" || body?.reason === "insufficient") void load();
      return setError(giftFailureText(body?.reason, body?.error));
    }
    if (skipWeek) skipConfirmForAWeek();
    dismissCoach();
    haptic("medium");
    // the amounts are the server's
    const left = typeof body?.balanceAfter === "number" ? ` · ${fgcText(body.balanceAfter)} left` : "";
    toast(`${(body?.quantity ?? quantity) > 1 ? `${body?.quantity ?? quantity} gifts sent` : "Gift sent"} · −${fgcText(body?.totalFgc ?? total)} FGC${left}`, "success");
    key.current = null;
    // the balance changed: the next open reads it fresh (the cached one is replaced, never trusted)
    void load();
    onSent();
    onClose();
  };

  const onSendTap = () => {
    if (!chosen || !recipient || sending || short || !noteCheck.ok) return;
    if (confirmSkipped()) return void send();
    setSkipWeek(false);
    setConfirming(true);
  };

  return (
    <GlassSheetShell open onClose={onClose} title={chosen ? chosen.name : "Sticker gifts"} defaultHeightVh={88} {...(zIndex ? { backdropZ: zIndex, panelZ: zIndex + 1 } : {})}>
      <div className="flex flex-col gap-4 px-4 pb-6">
        {!chosen ? (
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-frenz-fill px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs text-frenz-muted">{requireChoice ? "Sending in this group" : `Sending to ${recipients[0]?.name ?? "this chat"}`}</p>
              <p className="text-[11px] text-frenz-muted">Gift Coins (FGC) are separate from Frenz Coins. <Link href="/wallet/gifts" className="font-semibold underline">Your Gift Box</Link></p>
            </div>
            <BalancePill available={data ? available : null} />
          </div>
        ) : null}
        {!chosen && data && data.wallet.pending > 0 ? <p className="-mt-2 text-[11px] text-frenz-muted">{fgcText(data.wallet.pending)} FGC from gifts you received is on hold{data.wallet.nextReleaseAt ? ` until ${new Date(data.wallet.nextReleaseAt).toLocaleString()}` : ""} — not spendable yet.</p> : null}

        {loadError ? (
          <div className="rounded-2xl bg-rose-500/10 p-4 text-sm text-rose-800 dark:text-rose-200" role="alert">
            {loadError}{" "}
            <button type="button" className="font-semibold underline" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : !data ? (
          <div className="grid grid-cols-3 gap-3" aria-busy="true" aria-label="Loading stickers">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-36 rounded-[22px] bg-frenz-fill motion-safe:animate-pulse" />
            ))}
          </div>
        ) : !data.giftingReady ? (
          <p className="rounded-2xl bg-frenz-fill p-4 text-sm text-frenz-muted">Sticker gifts aren&apos;t available yet.</p>
        ) : chosen ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <button type="button" className="flex h-10 items-center gap-1 rounded-full px-1 text-sm font-semibold text-frenz-muted" onClick={back}>
                <span aria-hidden>‹</span> Stickers
              </button>
              <BalancePill available={available} />
            </div>

            {/* the stage (screen 3): the sticker pops in once — a plain fade under Reduce Motion */}
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-32 w-full items-center justify-center rounded-[28px] bg-[radial-gradient(circle_at_50%_40%,hsl(var(--frenz-violet)/0.16),transparent_70%)]">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded sticker artwork, already a sized WebP */}
                {chosen.animationUrl || chosen.imageUrl ? <img key={chosen.id} src={(chosen.animationUrl ?? chosen.imageUrl)!} alt="" className="h-28 w-28 object-contain motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-300 motion-reduce:animate-in motion-reduce:fade-in" /> : <span className="text-5xl" aria-hidden>🎁</span>}
              </div>
              {RARITY_TAG[chosen.rarity] ? <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", RARITY_TAG[chosen.rarity]!.className)}>{RARITY_TAG[chosen.rarity]!.label}</span> : null}
              <h3 className="text-[22px] font-extrabold leading-tight tracking-tight">{chosen.name}</h3>
              {chosen.description ? <p className="max-w-[290px] text-[15px] leading-snug text-frenz-muted">{chosen.description}</p> : null}
            </div>

            <div className="divide-y divide-frenz-line overflow-hidden rounded-[22px] border border-white/60 bg-white/75 shadow-frenz-card dark:bg-white/5">
              {requireChoice ? (
                <label className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-20 shrink-0 font-semibold text-frenz-muted">To</span>
                  <select className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3" value={recipient?.userId ?? ""} onChange={(e) => setRecipient(recipients.find((r) => r.userId === e.target.value) ?? null)}>
                    <option value="" disabled>
                      Choose who the gift is for
                    </option>
                    {recipients.map((r) => (
                      <option key={r.userId} value={r.userId}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="w-20 shrink-0 font-semibold text-frenz-muted">To</span>
                  <span className="font-semibold">{recipient?.name}</span>
                </div>
              )}
              <div className="flex items-center gap-3 px-4 py-2 text-sm">
                <span id="gift-qty-label" className="w-20 shrink-0 font-semibold text-frenz-muted">
                  Quantity
                </span>
                <div role="group" aria-labelledby="gift-qty-label" className="ml-auto flex items-center gap-1 rounded-full bg-frenz-fill p-1">
                  <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1 || sending} onClick={() => { haptic("light"); setQuantity((q) => Math.max(1, q - 1)); }} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg font-bold shadow-sm disabled:opacity-40 dark:bg-white/10">
                    −
                  </button>
                  <output aria-live="polite" aria-label={`Quantity ${quantity}`} className="w-8 text-center text-base font-bold tabular-nums">
                    {quantity}
                  </output>
                  <button type="button" aria-label="Increase quantity" disabled={quantity >= GIFT_BATCH_MAX || sending} onClick={() => { haptic("light"); setQuantity((q) => Math.min(GIFT_BATCH_MAX, q + 1)); }} className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg font-bold shadow-sm disabled:opacity-40 dark:bg-white/10">
                    +
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1 px-4 py-2.5 text-sm">
                <div className="flex items-center gap-3">
                  <label htmlFor="gift-note" className="w-20 shrink-0 font-semibold text-frenz-muted">
                    Note
                  </label>
                  <input
                    id="gift-note"
                    value={note}
                    disabled={sending}
                    onChange={(e) => setNote(e.target.value.replace(/[\r\n]+/g, " "))}
                    placeholder="Add a message (optional)"
                    aria-describedby="gift-note-count"
                    aria-invalid={!noteCheck.ok}
                    className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-frenz-muted"
                  />
                </div>
                <p id="gift-note-count" className={cn("self-end text-[11.5px] tabular-nums", noteCheck.ok ? "text-frenz-muted" : "font-semibold text-rose-600")}>
                  {noteCheck.ok ? `${noteChars}/${GIFT_NOTE_MAX}` : noteCheck.reason === "note_too_long" ? `${noteChars}/${GIFT_NOTE_MAX} — too long` : "Plain text only"}
                </p>
              </div>
            </div>

            {error ? <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">{error}</p> : null}

            {short ? (
              <TopUp back={backHref ?? (resolvedId ? `/messages/${resolvedId}` : "/messages")} sticker={chosen} quantity={quantity} available={available} needed={total} />
            ) : confirming ? (
              <div role="alertdialog" aria-labelledby="gift-confirm-title" aria-describedby="gift-confirm-desc" className="flex flex-col gap-3 rounded-[22px] border border-frenz-violet/25 bg-frenz-violet/[0.06] p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
                <h4 id="gift-confirm-title" className="text-[15px] font-bold">
                  Send this gift?
                </h4>
                <p id="gift-confirm-desc" className="text-sm text-frenz-muted">
                  {quantity > 1 ? `${quantity} × ${chosen.name}` : chosen.name} to {recipient?.name} for <strong className="text-frenz-ink">{fgcText(total)} Gift Coins</strong>. Gifts can&apos;t be taken back once sent.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={skipWeek} onChange={(e) => setSkipWeek(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--frenz-violet))]" />
                  Don&apos;t ask me again for a week
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={sending} onClick={() => setConfirming(false)} className="h-11 rounded-full bg-frenz-fill text-sm font-semibold">
                    Cancel
                  </button>
                  <button type="button" disabled={sending} aria-busy={sending} onClick={() => void send()} autoFocus className="h-11 rounded-full bg-frenz-gradient-x text-sm font-bold text-white shadow-frenz-card disabled:opacity-60">
                    {sending ? (
                      <span className="flex items-center justify-center gap-2">
                        <Spinner size={16} /> Sending…
                      </span>
                    ) : (
                      "Send"
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button type="button" className="flex h-[52px] items-center justify-between rounded-full bg-frenz-gradient-x pl-6 pr-2 text-base font-bold text-white shadow-frenz-card disabled:opacity-50" disabled={sending || !recipient || !noteCheck.ok} aria-busy={sending} onClick={onSendTap}>
                  {sending ? (
                    <span className="flex w-full items-center justify-center gap-2">
                      <Spinner size={18} /> Sending…
                    </span>
                  ) : (
                    <>
                      <span>{quantity > 1 ? `Send ${quantity} gifts` : "Send gift"}</span>
                      <span className="rounded-full bg-white/20 px-3 py-1.5 text-sm tabular-nums">{fgcText(total)} FGC</span>
                    </>
                  )}
                </button>
                <p className="-mt-2 text-center text-xs text-frenz-muted">{recipient ? (place ? `Shows in the comments for ${recipient.name} to see.` : `Delivered instantly to your chat with ${recipient.name}.`) : "Choose who the gift is for."}</p>
              </>
            )}
          </div>
        ) : data.stickers.length === 0 ? (
          <p className="rounded-2xl bg-frenz-fill p-4 text-sm text-frenz-muted">No stickers to gift yet.</p>
        ) : (
          <>
            {cats.length > 0 ? (
              <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Sticker categories">
                {[null, ...cats].map((c) => (
                  <button key={c ?? "all"} type="button" role="tab" aria-selected={category === c} onClick={() => setCategory(c)} className={cn("whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold capitalize", category === c ? "bg-frenz-gradient-x text-white" : "bg-frenz-fill text-frenz-ink/80")}>
                    {c ?? "All"}
                  </button>
                ))}
              </div>
            ) : null}
            {featured && !category ? (
              <button type="button" onClick={() => pick(featured)} className="flex items-center gap-3 rounded-[22px] bg-frenz-gradient-x p-4 text-left text-white shadow-frenz-card transition active:scale-[0.98]">
                {/* eslint-disable-next-line @next/next/no-img-element -- uploaded sticker artwork */}
                {featured.imageUrl ? <img src={featured.imageUrl} alt="" className="h-16 w-16 object-contain origin-bottom motion-safe:animate-sticker" /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs opacity-80">Featured</span>
                  <span className="block truncate text-base font-bold">{featured.name}</span>
                </span>
                <span className="rounded-full bg-white/95 px-3 py-1 text-sm font-bold text-frenz-ink">{fgcText(featured.priceFgc)}</span>
              </button>
            ) : null}
            {shown.length === 0 ? (
              <p className="rounded-2xl bg-frenz-fill p-4 text-sm text-frenz-muted">No stickers in this category.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {shown.map((s, i) => {
                  const locked = s.priceFgc > available;
                  const tag = RARITY_TAG[s.rarity];
                  // one plays at a time, first to last — or the one under the finger / pointer
                  const playing = hovered === null ? turn % shown.length === i : hovered === s.id;
                  return (
                    <button key={s.id} type="button" onClick={() => pick(s)} onPointerEnter={() => setHovered(s.id)} onPointerLeave={() => setHovered(null)} onFocus={() => setHovered(s.id)} onBlur={() => setHovered(null)} aria-label={`${s.name}, ${fgcText(s.priceFgc)} Gift Coins${locked ? ", more Gift Coins needed" : ""}`} className="flex min-h-[44px] flex-col items-center gap-1 rounded-[22px] bg-white/70 p-2 text-center shadow-frenz-card transition active:scale-[0.96] dark:bg-white/5">
                      {/* eslint-disable-next-line @next/next/no-img-element -- uploaded sticker artwork */}
                      {s.imageUrl ? <img key={playing ? `p${turn}-${hovered ?? ""}` : "still"} src={s.imageUrl} alt="" loading="lazy" className={cn("h-16 w-16 origin-bottom object-contain", playing && "motion-safe:animate-sticker-once")} /> : <span className="h-16 w-16" />}
                      <span className="line-clamp-1 text-xs font-semibold">{s.name}</span>
                      <span className={cn("text-[13px] font-bold", locked && "text-frenz-muted")}>{fgcText(s.priceFgc)}</span>
                      {tag ? <span className={cn("rounded-full px-1.5 text-[10px] font-semibold", tag.className)}>{tag.label}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </GlassSheetShell>
  );
}

function BalancePill({ available }: { available: number | null }) {
  return (
    <span className="shrink-0 rounded-full bg-amber-400/20 px-3 py-1 text-sm font-bold tabular-nums text-amber-900 dark:text-amber-200" aria-label={available === null ? "Loading your Gift Coins" : `Available: ${fgcText(available)} Gift Coins`}>
      {available === null ? "…" : `${fgcText(available)} FGC`}
    </span>
  );
}

/**
 * Screen 6 — "not enough Gift Coins", as a route through what already exists (owner decision): Frenz Coins are funded
 * with the existing deposit, then converted with the existing conversion. Nothing here charges, deposits or converts:
 * each button only OPENS the screen where the member confirms that step, and the chat is remembered so the Gift Box can
 * bring them back. No coin packs — the design's App Store packs don't exist on the web.
 */
function TopUp({ back, sticker, quantity, available, needed }: { back: string; sticker: Sticker; quantity: number; available: number; needed: number }) {
  const pct = needed > 0 ? Math.min(100, Math.round((available / needed) * 100)) : 0;
  return (
    <section aria-labelledby="gift-topup-title" className="flex flex-col gap-3 rounded-[22px] border border-white/60 bg-white/75 p-4 shadow-frenz-card dark:bg-white/5">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-amber-400/15">
          {/* eslint-disable-next-line @next/next/no-img-element -- uploaded sticker artwork */}
          {sticker.imageUrl ? <img src={sticker.imageUrl} alt="" className="h-11 w-11 object-contain origin-bottom motion-safe:animate-sticker" /> : <span aria-hidden>🎁</span>}
        </span>
        <div className="min-w-0 flex-1">
          <h4 id="gift-topup-title" className="text-[15px] font-bold">
            {quantity > 1 ? `${quantity} × ${sticker.name}` : sticker.name} needs {fgcText(needed)} Gift Coins
          </h4>
          <div role="progressbar" aria-label="Gift Coins toward this gift" aria-valuemin={0} aria-valuemax={needed} aria-valuenow={Math.min(available, needed)} className="mt-2 h-2 overflow-hidden rounded-full bg-frenz-fill">
            <i className="block h-full rounded-full bg-frenz-gradient-x" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1.5 flex justify-between text-xs tabular-nums text-frenz-muted">
            <span>You have {fgcText(available)}</span>
            <span>{fgcText(needed - available)} more to go</span>
          </div>
        </div>
      </div>
      <p className="text-sm text-frenz-muted">Gift Coins come from Frenz Coins. Convert Frenz Coins you already have, or add Frenz Coins first, then convert. Gift earnings on hold can&apos;t be spent until they&apos;re released.</p>
      <Link href={`/wallet/gifts?convert=fc_to_fgc&back=${encodeURIComponent(back)}`} prefetch onClick={() => rememberGiftReturn(back)} className="flex h-12 items-center justify-center rounded-full bg-frenz-gradient-x text-base font-bold text-white shadow-frenz-card">
        Convert Frenz Coins
      </Link>
      <Link href="/wallet/deposit" prefetch onClick={() => rememberGiftReturn(back)} className="flex h-12 items-center justify-center rounded-full bg-frenz-fill text-base font-semibold">
        Add Frenz Coins
      </Link>
      <p className="text-center text-xs text-frenz-muted">Nothing is charged until you confirm on the next screen.</p>
    </section>
  );
}
