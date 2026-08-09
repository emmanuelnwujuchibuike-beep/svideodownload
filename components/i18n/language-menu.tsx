"use client";

import { Check, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { languageNote, languageStatus } from "@/lib/i18n/language-status";
import { LANGUAGE_COOKIE, LANGUAGES } from "@/lib/i18n/languages";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

/**
 * The language picker's dropdown panel — the search box, the full ~50-language
 * list, and the persistence. Deliberately a SEPARATE module from the header
 * trigger: it is loaded with a dynamic `import()` only when the globe is tapped, so
 * the language table + this markup stay OFF every marketing page's first-load JS
 * (the 2-second cold-entry budget). The trigger keeps just the code label.
 */
export function LanguageMenu({
  current,
  onChoose,
  onClose,
}: {
  current: string;
  onChoose: (code: string) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const s = q.trim().toLowerCase();
  const filtered = s
    ? LANGUAGES.filter((l) => l.name.toLowerCase().includes(s) || l.native.toLowerCase().includes(s) || l.code.includes(s))
    : LANGUAGES;

  /*
    Translated languages FIRST (owner, 2026-08-09: "the language selections
    still doesn't work").

    They do not, for 52 of the 53 entries, because no strings exist for them —
    see lib/i18n/language-status. Sorting the ones that genuinely work to the top
    and captioning the rest is what turns a silent no-op into an honest choice.
    A stable sort, so within each group the owner's ordering survives.
  */
  const ordered = [...filtered].sort(
    (a, b) => Number(languageStatus(b.code) === "live") - Number(languageStatus(a.code) === "live"),
  );
  const liveCount = ordered.filter((l) => languageStatus(l.code) === "live").length;

  const choose = (code: string) => {
    haptic("selection");
    playSound("tap");
    try {
      const secure = location.protocol === "https:" ? "; secure" : "";
      document.cookie = `${LANGUAGE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax${secure}`;
      localStorage.setItem(LANGUAGE_COOKIE, code);
      document.documentElement.setAttribute("lang", code);
      /*
        Tell every mounted consumer at once (owner: "language doesn't update
        instantly when switched").

        The cookie alone changed nothing on screen — nothing read it. This
        event is what makes `useLocale` re-resolve in the chrome immediately,
        and `router.refresh()` below re-renders server components with the new
        cookie. Neither is a page reload, so scroll position and any in-flight
        download survive.
      */
      window.dispatchEvent(new Event("frenz:locale"));
    } catch {
      /* storage blocked */
    }
    router.refresh();
    onChoose(code);
  };

  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 z-[60] cursor-default" />
      <div
        role="menu"
        aria-label="Choose a language"
        className="fixed right-2 top-[calc(var(--frenz-safe-top)+3.75rem)] z-[61] w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
      >
        <div className="border-b border-border/60 p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search language…"
              aria-label="Search language"
              className="h-10 w-full rounded-xl bg-secondary/60 pl-9 pr-3 text-sm outline-none ring-1 ring-inset ring-border/50 transition focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto overscroll-contain p-1.5">
          {ordered.map((l, i) => {
            const note = languageNote(l.code);
            /* One divider where the translated languages end — the honest edge
               of what this switcher can do today. Hidden while searching, where
               the grouping is noise. */
            const divider = !s && i === liveCount && liveCount > 0;
            return (
              <div key={l.code}>
                {divider ? (
                  <p className="mb-1 mt-2 px-3 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Not translated yet
                  </p>
                ) : null}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={l.code === current}
                  onClick={() => choose(l.code)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition duration-150 active:scale-[0.98]",
                    l.code === current ? "bg-primary/10" : "hover:bg-secondary",
                  )}
                >
                  <span className="min-w-0">
                    <span className={cn("block truncate text-sm font-semibold", note && "text-muted-foreground")}>
                      {l.native}
                    </span>
                    {/*
                      The caption is the whole point of this change: the choice
                      is still saved (a remembered preference is real), but
                      nobody is left wondering why the page is still English.
                    */}
                    <span className="block truncate text-xs text-muted-foreground">{note ?? l.name}</span>
                  </span>
                  {l.code === current ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                </button>
              </div>
            );
          })}
          {ordered.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">No language matches.</p> : null}
        </div>
      </div>
    </>
  );
}
