"use client";

import { Bookmark, BookmarkCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import { STICKER_GROUPS, STICKERS, type Sticker } from "@/lib/social/stickers";
import { cn } from "@/lib/utils";

/**
 * Sticker tray — pick a sticker to comment with, plus a "Saved" tab backed by
 * the member's collection (/api/stickers). Long-press or tap the ribbon to
 * save/unsave. Asset-free (emoji glyphs rendered large).
 */
export function StickerPicker({
  onPick,
  onClose,
}: {
  onPick: (sticker: Sticker) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"saved" | Sticker["group"]>("reactions");
  const [saved, setSaved] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/stickers")
      .then((r) => (r.ok ? r.json() : { saved: [] }))
      .then((j: { saved: string[] }) => alive && setSaved(j.saved ?? []))
      .catch(() => alive && setSaved([]));
    return () => {
      alive = false;
    };
  }, []);

  const toggleSave = async (id: string) => {
    const isSaved = saved?.includes(id);
    setSaved((s) => (isSaved ? (s ?? []).filter((x) => x !== id) : [...(s ?? []), id]));
    try {
      if (isSaved) await fetch(`/api/stickers?sticker=${encodeURIComponent(id)}`, { method: "DELETE" });
      else await fetch("/api/stickers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sticker: id }) });
    } catch {
      /* revert on failure */
      setSaved((s) => (isSaved ? [...(s ?? []), id] : (s ?? []).filter((x) => x !== id)));
    }
  };

  const shown: Sticker[] =
    tab === "saved" ? STICKERS.filter((s) => saved?.includes(s.id)) : STICKERS.filter((s) => s.group === tab);

  return (
    <div className="rounded-2xl border border-border/70 bg-card shadow-lg">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/60 px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TabChip active={tab === "saved"} onClick={() => setTab("saved")}>
          ★ Saved
        </TabChip>
        {STICKER_GROUPS.map((g) => (
          <TabChip key={g.key} active={tab === g.key} onClick={() => setTab(g.key)}>
            {g.label}
          </TabChip>
        ))}
        <button type="button" onClick={onClose} aria-label="Close stickers" className="ml-auto shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>

      {tab === "saved" && saved !== null && shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-muted-foreground">
          No saved stickers yet. Tap the ribbon on any sticker to save it here.
        </p>
      ) : (
        <div className="grid max-h-48 grid-cols-5 gap-1 overflow-y-auto p-2 sm:grid-cols-6">
          {shown.map((s) => (
            <div key={s.id} className="group relative">
              <button
                type="button"
                onClick={() => onPick(s)}
                aria-label={s.label}
                className="flex aspect-square w-full items-center justify-center rounded-xl text-3xl transition hover:bg-secondary active:scale-90"
              >
                {s.glyph}
              </button>
              <button
                type="button"
                onClick={() => toggleSave(s.id)}
                aria-label={saved?.includes(s.id) ? "Unsave" : "Save sticker"}
                className={cn(
                  "absolute right-0.5 top-0.5 rounded-full p-1 opacity-0 transition group-hover:opacity-100",
                  saved?.includes(s.id) ? "text-primary opacity-100" : "text-muted-foreground",
                )}
              >
                {saved?.includes(s.id) ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold transition",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}
