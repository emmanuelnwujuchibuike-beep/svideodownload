"use client";

import { Loader2, Megaphone, RefreshCw, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { EX_CARD, exField, exPrimary, exQuiet } from "@/features/sub/ui";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * Subscriber announcements (Frenz Exclusive Part 6). The server decides who may read them
 * (/api/sub/announcements: the creator, or an active subscriber right now); a visitor without
 * access gets `access: false` and this renders nothing at all.
 */

interface Delivery {
  state: "pending" | "done" | "cancelled";
  handedOff: number;
  skipped: number;
  failed: number;
  /** Part 10: claimed by a send that was interrupted — not retried, so nobody gets it twice; outcome unknown */
  unconfirmed?: number;
}
interface Item {
  id: string;
  title: string | null;
  body: string;
  createdAt: string;
  delivery?: Delivery | null;
}
type Page = { access: boolean; items: Item[]; next: string | null };

const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

function useAnnouncements(creatorId: string) {
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      const res = await fetch(`/api/sub/announcements?creator=${creatorId}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" }).catch(() => null);
      const j = (await res?.json().catch(() => null)) as Page | null;
      setLoading(false);
      if (!res?.ok || !j) return setError(true);
      setError(false);
      setPage((p) => (cursor && p ? { ...j, items: [...p.items, ...j.items.filter((x) => !p.items.some((y) => y.id === x.id))] } : j));
    },
    [creatorId],
  );
  useEffect(() => {
    void load(null);
  }, [load]);
  return { page, setPage, error, loading, load };
}

function List({ items, onDelete }: { items: Item[]; onDelete?: (id: string) => void }) {
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li key={a.id} className="rounded-2xl bg-black/[0.03] px-3.5 py-3 dark:bg-white/[0.05]">
          <div className="flex items-start justify-between gap-2">
            <p className="min-w-0 text-[14.5px] font-bold leading-snug">{a.title ?? "Announcement"}</p>
            {onDelete ? (
              <button type="button" onClick={() => onDelete(a.id)} aria-label={`Delete "${a.title ?? "announcement"}"`} className="-mr-1.5 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/[0.08]">
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
          <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-foreground/85">{a.body}</p>
          <p className="mt-1.5 text-[12px] text-muted-foreground" suppressHydrationWarning>
            {fmt(a.createdAt)}
          </p>
          {a.delivery ? <DeliveryChips d={a.delivery} /> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * What the fan-out did, as labelled numbers. Never says "delivered": the app only knows what it
 * handed to the push / email pipeline ("queued"), what it skipped and what failed.
 */
function DeliveryChips({ d }: { d: Delivery }) {
  const chip = "inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums";
  return (
    <ul aria-label="Notification status" className="mt-2 flex flex-wrap gap-1.5">
      {d.state !== "done" ? <li className={cn(chip, d.state === "pending" ? "bg-accent/10 text-accent" : "bg-black/[0.05] dark:bg-white/[0.07] text-muted-foreground")}>{d.state === "pending" ? "Sending…" : "Stopped"}</li> : null}
      <li className={cn(chip, "bg-primary/10 text-primary")}>Queued {d.handedOff.toLocaleString()}</li>
      {d.skipped ? <li className={cn(chip, "bg-black/[0.05] dark:bg-white/[0.07] text-muted-foreground")} title="Opted out, or not eligible right now">Skipped {d.skipped.toLocaleString()}</li> : null}
      {d.failed ? <li className={cn(chip, "bg-rose-500/10 text-rose-600 dark:text-rose-400")}>Failed {d.failed.toLocaleString()}</li> : null}
      {d.unconfirmed ? (
        <li className={cn(chip, "bg-amber-500/10 text-amber-800 dark:text-amber-300")} title="The send was interrupted for these. They aren't retried, so nobody gets it twice.">
          Unconfirmed {d.unconfirmed.toLocaleString()}
        </li>
      ) : null}
    </ul>
  );
}

/** What a subscriber sees on the tab — nothing at all for anyone without access. */
export function SubscriberAnnouncements({ creatorId }: { creatorId: string }) {
  const { page, error, loading, load } = useAnnouncements(creatorId);
  if (!page?.access || (!page.items.length && !error)) return null;
  return (
    <section id="announcements" aria-labelledby="ann-title" className={cn("mb-3 scroll-mt-20 rounded-[22px] p-3.5", EX_CARD)}>
      <h2 id="ann-title" className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
        <Megaphone className="h-4 w-4 text-primary" aria-hidden /> Announcements for subscribers
      </h2>
      <List items={page.items} />
      {page.next ? (
        <button type="button" onClick={() => void load(page.next)} disabled={loading} className={cn(exQuiet, "mt-2 w-full justify-center")}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Older announcements
        </button>
      ) : null}
    </section>
  );
}

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2)}`);

/** The creator's side: write one for subscribers, see what was sent, delete. */
export function CreatorAnnouncements({ creatorId }: { creatorId: string }) {
  const { page, setPage, error, loading, load } = useAnnouncements(creatorId);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // one key per draft: a retried tap (or a double tap) publishes once
  const key = useRef(newKey());

  const publish = async () => {
    if (busy) return;
    haptic("selection");
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/sub/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body, idempotencyKey: key.current }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { announcement?: Item; error?: string; queued?: boolean } | null;
    setBusy(false);
    if (!res?.ok || !j?.announcement) return setNote(j?.error ?? (res ? "Couldn't publish that." : "You're offline. Nothing was sent."));
    setTitle("");
    setBody("");
    key.current = newKey();
    setNote(j.queued ? "Published. Your active subscribers are being notified now." : "Published. Notifications start with the next update.");
    void load(null);
  };

  const remove = async (id: string) => {
    haptic("selection");
    const before = page;
    setPage((p) => (p ? { ...p, items: p.items.filter((x) => x.id !== id) } : p));
    const res = await fetch(`/api/sub/announcements?id=${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setPage(before);
      setNote("Couldn't delete that. Try again.");
    }
  };

  const valid = title.trim().length >= 1 && title.trim().length <= 80 && body.trim().length >= 1 && body.trim().length <= 2000;
  return (
    <section id="announcements" aria-labelledby="cann-title" className={cn("mb-3 rounded-[22px] p-3.5", EX_CARD)}>
      <h2 id="cann-title" className="flex items-center gap-2 text-[14.5px] font-semibold">
        <Megaphone className="h-4 w-4 text-primary" aria-hidden /> Announce to subscribers
      </h2>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">Only your active subscribers can read it. They&apos;re notified the way they chose; the notification never shows the message itself.</p>
      <label className="mt-3 block text-[12.5px] font-medium text-muted-foreground">
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} className={cn(exField, "mt-1")} />
      </label>
      <label className="mt-2 block text-[12.5px] font-medium text-muted-foreground">
        Message
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} rows={3} className={cn(exField, "mt-1 resize-none")} />
      </label>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11.5px] tabular-nums text-muted-foreground">{body.length}/2000</span>
        <button type="button" onClick={() => void publish()} disabled={!valid || busy} className={exPrimary}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} {busy ? "Publishing…" : "Publish to subscribers"}
        </button>
      </div>
      <div aria-live="polite">{note ? <p className="mt-2 text-[12.5px] font-medium">{note}</p> : null}</div>
      {page?.items.length ? (
        <div className="mt-3">
          <List items={page.items} onDelete={(id) => void remove(id)} />
          <p className="mt-2 text-[11.5px] text-muted-foreground">Queued = handed to each subscriber&apos;s push or email; delivery itself can&apos;t be confirmed. Skipped = opted out or no longer eligible. Unconfirmed = the send was interrupted and isn&apos;t repeated.</p>
          {page.next ? (
            <button type="button" onClick={() => void load(page.next)} disabled={loading} className={cn(exQuiet, "mt-2 w-full justify-center")}>
              Older announcements
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <button type="button" onClick={() => void load(null)} className={cn(exQuiet, "mt-2")}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Retry loading announcements
        </button>
      ) : null}
    </section>
  );
}
