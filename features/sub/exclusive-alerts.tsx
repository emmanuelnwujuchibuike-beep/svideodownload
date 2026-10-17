"use client";

import { Bell, Loader2, Megaphone, Star } from "lucide-react";
import { useEffect, useState } from "react";

import { EX_CARD } from "@/features/sub/ui";
import { ALERT_OPTIONS, Segmented, type AlertMode } from "@/features/sub/segmented";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * A visitor's controls on a creator's Exclusive tab (Frenz Exclusive Part 6): favourite the creator,
 * and choose how to hear about their new private posts and their subscriber announcements.
 * One GET for all three (/api/sub/notify). Each choice answers on the tap; the server confirms;
 * a refused save puts the old choice back. Favouriting is a bookmark: it grants no access and is
 * independent of any subscription.
 */

type Mode = AlertMode;

export function ExclusiveAlerts({ creatorId, creatorName }: { creatorId: string; creatorName: string }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [ann, setAnn] = useState<Mode | null>(null);
  const [fav, setFav] = useState<boolean | null>(null);
  const [favBusy, setFavBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/sub/notify?creator=${creatorId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { mode?: Mode; announcements?: Mode; favourite?: boolean }) => {
        if (!alive) return;
        setMode(j.mode ?? "off");
        setAnn(j.announcements ?? "push");
        setFav(!!j.favourite);
      })
      .catch(() => {
        if (!alive) return;
        setMode("off");
        setAnn("push");
        setFav(false);
      });
    return () => {
      alive = false;
    };
  }, [creatorId]);

  const save = (field: "mode" | "announcements", next: Mode, prev: Mode | null, set: (m: Mode | null) => void) => {
    if (next === prev) return;
    haptic("selection");
    set(next);
    setNote(null);
    void fetch("/api/sub/notify", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creator: creatorId, [field]: next }) })
      .then(async (r) => {
        if (r.ok) return;
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        set(prev);
        setNote(j.error ?? "Couldn't save that.");
      })
      .catch(() => {
        set(prev);
        setNote("Couldn't save that.");
      });
  };

  const toggleFav = async () => {
    if (fav === null || favBusy) return;
    haptic("selection");
    const prev = fav;
    setFav(!prev);
    setFavBusy(true);
    setNote(null);
    const r = await fetch("/api/sub/favourites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: prev ? "remove" : "add", creatorId }) }).catch(() => null);
    setFavBusy(false);
    if (!r?.ok) {
      const j = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
      setFav(prev);
      setNote(j?.error ?? "Couldn't save that.");
    }
  };

  return (
    <div className={cn("mb-3 rounded-[22px] p-3.5", EX_CARD)}>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-[14px] font-semibold">Stay close to {creatorName}</p>
        <button
          type="button"
          aria-pressed={!!fav}
          disabled={fav === null}
          onClick={() => void toggleFav()}
          className={cn(
            "inline-flex min-h-[2.5rem] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
            fav ? "bg-gold/15 text-foreground" : "bg-black/[0.04] text-foreground/80 dark:bg-white/[0.07]",
          )}
        >
          {favBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Star className={cn("h-4 w-4", fav && "fill-gold text-gold")} aria-hidden />}
          {fav ? "In favourites" : "Add to favourites"}
        </button>
      </div>
      <Choice icon={<Bell className="h-4 w-4 text-primary" aria-hidden />} title="New private posts" hint="Get told when they post something new here." label="How to tell you about new private posts" value={mode} onChoose={(m) => save("mode", m, mode, setMode)} />
      <Choice icon={<Megaphone className="h-4 w-4 text-primary" aria-hidden />} title="Announcements" hint="Messages they send to subscribers. Only sent while you're subscribed." label="How to tell you about announcements" value={ann} onChoose={(m) => save("announcements", m, ann, setAnn)} />
      {note ? (
        <p role="alert" className="mt-2 text-[12.5px] text-rose-600 dark:text-rose-400">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function Choice({ icon, title, hint, label, value, onChoose }: { icon: React.ReactNode; title: string; hint: string; label: string; value: Mode | null; onChoose: (m: Mode) => void }) {
  return (
    <div className="mt-3 border-t border-black/[0.06] pt-3 dark:border-white/[0.07]">
      <p className="flex items-center gap-2 text-[13.5px] font-semibold">
        {icon} {title}
      </p>
      <p className="mb-2 mt-0.5 text-[12.5px] text-muted-foreground">{hint}</p>
      <Segmented label={label} value={value} options={ALERT_OPTIONS} onChange={onChoose} />
    </div>
  );
}
