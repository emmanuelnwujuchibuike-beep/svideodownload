"use client";

import { CornerDownLeft, Pin, PinOff, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { SETTINGS_TINTS } from "@/features/account/settings-ui";
import { getCategory } from "@/lib/settings/categories";
import { getSetting, type SettingEntry } from "@/lib/settings/registry";
import { searchSettings } from "@/lib/settings/search";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

/**
 * Smart Settings Search™ + Quick Settings (Feature 18 · Part 21).
 *
 * ── Why this is a client island and the rest of the page is not ─────────────
 * The Settings root is a server component that reads the member's real plan,
 * health and security state. Only the search box and the pin list need
 * interactivity, so only they hydrate. The category list underneath stays
 * server-rendered and is the thing that paints first — which matters because
 * this page is opened when something is already annoying somebody.
 *
 * ── Search runs entirely on the device ──────────────────────────────────────
 * The registry is a few kilobytes of strings already in this chunk. No request
 * per keystroke, no debounce, no loading state, and it works offline — which is
 * the right behaviour for a screen whose job is "let me turn that thing off".
 */

const PINS_KEY = "frenz:settings:pins";
const MAX_PINS = 6;

/** Pins a member starts with, so the row is never an empty box on first open. */
const DEFAULT_PINS = ["appearance.theme", "privacy.ghost", "notifications.pause", "language.language"];

/**
 * Example searches, shown as chips under an empty field.
 *
 * 🔴 Each one was run through `searchSettings` and returns results — dark mode
 * (1 hit), 2fa (1), notifications (4), privacy (8), language (2). A chip that
 * finds nothing is a promise the page cannot keep, so re-check these if a
 * settings entry is ever renamed.
 *
 * Five, and short ones, so they fit two rows at 393px without wrapping mid-word.
 */
const SUGGESTIONS = ["Dark mode", "2FA", "Notifications", "Privacy", "Language"];

function readPins(): string[] {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (!raw) return DEFAULT_PINS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_PINS;
    // Drop ids that no longer exist — a renamed setting must not leave a ghost.
    return parsed.filter((id): id is string => typeof id === "string" && !!getSetting(id)).slice(0, MAX_PINS);
  } catch {
    return DEFAULT_PINS;
  }
}

export function SettingsSearch() {
  const [query, setQuery] = useState("");
  /*
    Null until read from storage, so the first paint does not flash the defaults
    at somebody who has pinned their own. Server and client agree on `null`.
  */
  const [pins, setPins] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setPins(readPins()), []);

  const persist = (next: string[]) => {
    setPins(next);
    try {
      localStorage.setItem(PINS_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked — the pins just will not survive this session */
    }
  };

  const togglePin = (id: string) => {
    haptic("selection");
    const current = pins ?? DEFAULT_PINS;
    persist(
      current.includes(id)
        ? current.filter((p) => p !== id)
        : [...current, id].slice(-MAX_PINS),
    );
  };

  const hits = useMemo(() => searchSettings(query), [query]);
  const searching = query.trim().length > 0;

  return (
    <div className="mb-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          /*
            🔴 SHORT, because the long one was never fully readable.

            It was: Search settings — try “dark mode” or “2fa”. At 393px, behind
            a 3rem icon inset and a 2.75rem clear-button inset, that is ~24
            characters of room for a 44-character string, so every visitor saw it
            cut mid-word — "…or “2". A placeholder that truncates is worse than a
            short one: it reads as a layout bug, and the examples it was trying
            to teach are the part that gets eaten.

            The examples did not deserve to be in the placeholder at all. A
            placeholder disappears the moment someone types, so it is the worst
            place to put anything they might want to act on. They are tappable
            chips below the field now — same information, always legible, and
            they actually run the search.
          */
          placeholder="Search settings"
          aria-label="Search settings"
          /*
            🔴 `h-13` EMITTED NO CSS. Tailwind's height scale has no 13
            (…12, 14, 16), so the class compiled to nothing and the field has
            never had the 52px its author intended — it was sized only by its
            padding and line-height. Verified against the built stylesheet, the
            same silent-class family as `z-60` and `via-black/88`.

            `h-[3.25rem]` is that intended 52px, expressed as an arbitrary value
            so it cannot silently vanish again. The vertical padding goes with
            it: on a fixed-height input it does nothing, and leaving both invites
            the next person to "fix" the height by changing the padding.
          */
          /* The placeholder is softened one step so it reads as a hint rather
             than as a value someone has typed. Verified in the built stylesheet:
             this token IS declared with `<alpha-value>`, so the opacity modifier
             compiles to `color: hsl(var(--muted-foreground)/.7)`. */
          className="h-[3.25rem] w-full rounded-2xl bg-secondary/60 pl-12 pr-11 text-[15px] font-medium shadow-sm outline-none ring-1 ring-inset ring-border/40 transition placeholder:text-muted-foreground/70 focus:bg-background focus:ring-2 focus:ring-primary"
        />
        {searching ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground transition hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/*
        ── The examples, moved out of the placeholder ─────────────────────────
        This is where "try dark mode or 2fa" belonged all along. A placeholder
        vanishes the instant someone types, so it is the worst possible home for
        something you want them to act on — and at this width it could not even
        be read in full.

        🔴 Every chip is VERIFIED to return results. A suggestion that finds
        nothing is worse than no suggestion, so these were each run through
        `searchSettings` before being listed: dark mode (1), 2fa (1),
        notifications (4), privacy (8), language (2). If a settings entry is ever
        renamed, re-run them — a dead chip is a promise the page cannot keep.

        Shown only on the empty state: once there is a query the results below
        are the answer and these would be competing noise.
      */}
      {!searching ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                haptic("selection");
                setQuery(s);
                inputRef.current?.focus();
              }}
              className="rounded-full bg-secondary/50 px-3 py-1.5 text-[13px] font-medium text-muted-foreground ring-1 ring-inset ring-border/30 transition hover:bg-secondary hover:text-foreground active:scale-[0.97]"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {searching ? (
        <Results hits={hits} query={query} pins={pins ?? DEFAULT_PINS} onTogglePin={togglePin} />
      ) : (
        <Pinned ids={pins} onTogglePin={togglePin} />
      )}
    </div>
  );
}

/* ─────────────────────────────────── results ──────────────────────────────── */

function Results({
  hits,
  query,
  pins,
  onTogglePin,
}: {
  hits: ReturnType<typeof searchSettings>;
  query: string;
  pins: string[];
  onTogglePin: (id: string) => void;
}) {
  if (hits.length === 0) {
    return (
      /*
        An honest empty state. Search cannot answer a phrasing nobody
        anticipated — saying so, and pointing at the categories below, is better
        than an empty box that reads as "this setting does not exist".
      */
      <p className="mt-3 rounded-2xl border border-border/60 bg-card px-4 py-5 text-center text-sm text-muted-foreground">
        Nothing matches “{query.trim()}”. Try a simpler word, or browse the categories below.
      </p>
    );
  }

  return (
    <ul className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
      {hits.map(({ entry }) => (
        <li key={entry.id} className="border-b border-border/60 last:border-b-0">
          <ResultRow entry={entry} pinned={pins.includes(entry.id)} onTogglePin={onTogglePin} />
        </li>
      ))}
    </ul>
  );
}

function ResultRow({
  entry,
  pinned,
  onTogglePin,
}: {
  entry: SettingEntry;
  pinned: boolean;
  onTogglePin: (id: string) => void;
}) {
  const category = getCategory(entry.category);
  const reachable = entry.status === "live" && !!entry.href;

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{entry.label}</span>
          <span className="text-[11px] font-medium text-muted-foreground">{category?.label}</span>
          {/*
            A setting that changes what OTHER people can see is marked. A privacy
            control that reads like a cosmetic toggle is how people share more
            than they meant to.
          */}
          {entry.affectsOthers ? (
            <span className="rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
              Affects others
            </span>
          ) : null}
          {entry.status !== "live" ? (
            <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {entry.status === "planned" ? "Not built yet" : "No screen yet"}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{entry.description}</span>
        {/* The reason, verbatim from the registry — never "coming soon". */}
        {entry.status !== "live" && entry.note ? (
          <span className="mt-1 block text-[11px] leading-snug text-muted-foreground/80">{entry.note}</span>
        ) : null}
      </span>
      {reachable ? <CornerDownLeft className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
    </>
  );

  return (
    <div className="flex items-start gap-2 px-3.5 py-3">
      {reachable ? (
        <Link href={entry.href!} prefetch className="flex min-w-0 flex-1 items-start gap-2 text-left transition hover:opacity-80">
          {body}
        </Link>
      ) : (
        // Unreachable entries are NOT links. A row that looks tappable and does
        // nothing is the dead affordance this codebase keeps having to remove.
        <div className="flex min-w-0 flex-1 items-start gap-2 opacity-75">{body}</div>
      )}
      <button
        type="button"
        onClick={() => onTogglePin(entry.id)}
        aria-label={pinned ? `Unpin ${entry.label}` : `Pin ${entry.label}`}
        aria-pressed={pinned}
        className={cn(
          "shrink-0 rounded-lg p-1.5 transition",
          pinned ? "text-primary" : "text-muted-foreground/50 hover:text-foreground",
        )}
      >
        {pinned ? <Pin className="h-4 w-4 fill-current" /> : <Pin className="h-4 w-4" />}
      </button>
    </div>
  );
}

/* ─────────────────────────────────── pinned ───────────────────────────────── */

function Pinned({ ids, onTogglePin }: { ids: string[] | null; onTogglePin: (id: string) => void }) {
  // `null` = not read yet. Render nothing rather than flashing the defaults at
  // somebody who has their own pins — the row appears once, correct.
  if (ids === null) return null;
  const entries = ids.map(getSetting).filter((e): e is SettingEntry => !!e);
  if (entries.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="mb-2 px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Quick settings</p>
      <div className="flex flex-wrap gap-2">
        {entries.map((entry) => {
          const category = getCategory(entry.category);
          const tint = SETTINGS_TINTS[category?.tint ?? "slate"];
          const reachable = entry.status === "live" && !!entry.href;
          const Inner = (
            <>
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-md ring-1 ring-inset", tint)}>
                <Pin className="h-3 w-3" />
              </span>
              <span className="truncate">{entry.label}</span>
            </>
          );
          return (
            <span key={entry.id} className="group inline-flex items-center">
              {reachable ? (
                <Link
                  href={entry.href!}
                  prefetch
                  className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card py-2 pl-2 pr-3 text-xs font-bold shadow-sm transition hover:border-primary/40 active:scale-95"
                >
                  {Inner}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-xl border border-border/70 bg-card py-2 pl-2 pr-3 text-xs font-bold opacity-60">
                  {Inner}
                </span>
              )}
              <button
                type="button"
                onClick={() => onTogglePin(entry.id)}
                aria-label={`Unpin ${entry.label}`}
                className="-ml-1 rounded-lg p-1 text-muted-foreground/40 transition hover:text-rose-500"
              >
                <PinOff className="h-3.5 w-3.5" />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
