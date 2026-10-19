"use client";

import { BellOff, CornerDownLeft, Ghost, Moon, Pin, Search, X } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { LanguageSettingRow } from "@/components/i18n/language-setting-row";
import { useGhostMode } from "@/features/account/ghost-mode";
import { allSignals, ghostedCount, GHOST_SIGNALS, isFullyGhosted, type GhostState } from "@/lib/privacy/ghost";
import { getCachedThemeMode, setThemeModeLocal, subscribeThemeMode, type ThemeMode } from "@/lib/theme/theme-mode-client";
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

export function SettingsSearch({
  profile,
  ghost,
  notificationsOn,
}: {
  /** The server-rendered profile row (design/Settings.dc.html) — shown between the field and the tiles, hidden while searching. */
  profile?: ReactNode;
  /** The member's real Ghost Mode state, read on the server. */
  ghost: GhostState;
  /** Notifications' master switch (`masterEnabled`), read on the server. */
  notificationsOn: boolean;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
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
    <div className="frenz-ui text-frenz-ink">
      <div className="relative px-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-frenz-muted" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          type="search"
          /* Short on purpose: the long placeholder never fit at 393 px (2026-09). */
          placeholder="Search settings"
          aria-label="Search settings"
          className="h-10 w-full rounded-xl border-0 bg-frenz-fill pl-10 pr-11 text-[16px] outline-none placeholder:text-frenz-muted focus-visible:ring-2 focus-visible:ring-frenz-violet/40 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {searching ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-frenz-muted"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {/*
        The examples (each verified to return results — re-check if an entry is renamed). The design
        has no chips, so they appear only while the empty field has focus, where they help.
      */}
      {!searching && focused ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5 px-1">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              // mousedown, so the field keeps focus and the chips don't vanish before the tap lands
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                haptic("selection");
                setQuery(s);
                inputRef.current?.focus();
              }}
              className="min-h-9 rounded-full bg-frenz-fill px-3 text-[13px] font-semibold text-frenz-muted active:scale-[0.97]"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      {searching ? (
        <Results hits={hits} query={query} pins={pins ?? DEFAULT_PINS} onTogglePin={togglePin} />
      ) : (
        <>
          {profile}
          <QuickSettings ids={pins} onTogglePin={togglePin} ghost={ghost} notificationsOn={notificationsOn} />
        </>
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
      <p className="mx-1 mt-3 rounded-[20px] border border-frenz-line bg-frenz-card px-4 py-5 text-center text-sm text-frenz-muted">
        Nothing matches “{query.trim()}”. Try a simpler word, or browse the categories below.
      </p>
    );
  }

  return (
    <ul className="mx-1 mt-3 overflow-hidden rounded-[20px] border border-frenz-line bg-frenz-card">
      {hits.map(({ entry }) => (
        <li key={entry.id} className="border-b border-frenz-line last:border-b-0">
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
          "-my-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition",
          pinned ? "text-frenz-violet" : "text-frenz-muted/60 hover:text-frenz-ink",
        )}
      >
        {pinned ? <Pin className="h-4 w-4 fill-current" /> : <Pin className="h-4 w-4" />}
      </button>
    </div>
  );
}

/* ──────────────────────────────── quick settings ──────────────────────────── */

/**
 * Quick settings (design/Settings.dc.html, owner 2026-10-18): tiles with WORKING switches for Dark mode,
 * Ghost mode and Pause alerts, plus Language. The tiles are the member's pins (the existing pinning,
 * defaults unchanged); "Edit" replaces the old per-chip unpin buttons — in edit mode each tile can be
 * removed, and search results pin new ones. Any other pinned setting is a tile that opens its screen.
 */
function QuickSettings({
  ids,
  onTogglePin,
  ghost,
  notificationsOn,
}: {
  ids: string[] | null;
  onTogglePin: (id: string) => void;
  ghost: GhostState;
  notificationsOn: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // `null` = not read yet: render nothing rather than flash the defaults at someone with their own pins.
  if (ids === null) return null;
  const entries = ids.map(getSetting).filter((e): e is SettingEntry => !!e);

  return (
    <section aria-labelledby="quick-settings" className="mt-6">
      <div className="flex items-center justify-between px-1 pb-2">
        <h2 id="quick-settings" className="m-0 text-[13px] font-bold text-frenz-muted">
          Quick settings
        </h2>
        <button type="button" onClick={() => setEditing((e) => !e)} aria-pressed={editing} className="min-h-11 px-1 text-[13px] font-bold text-frenz-blue">
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      {editing ? <p className="-mt-1 mb-2 px-1 text-xs text-frenz-muted">Remove a tile here; pin more from search.</p> : null}
      {entries.length === 0 ? (
        <p className="rounded-[20px] border border-dashed border-frenz-line px-4 py-5 text-center text-sm text-frenz-muted">Nothing pinned. Search for a setting and pin it here.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2.5">
          {entries.map((entry) => (
            <li key={entry.id} className="relative">
              <QuickTile entry={entry} ghost={ghost} notificationsOn={notificationsOn} />
              {editing ? (
                <button
                  type="button"
                  onClick={() => onTogglePin(entry.id)}
                  aria-label={`Unpin ${entry.label}`}
                  className="absolute -right-1.5 -top-1.5 flex h-11 w-11 items-center justify-center"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-frenz-ink text-frenz-page shadow">
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TILE = "flex h-full w-full flex-col gap-3.5 rounded-[20px] border border-frenz-line bg-frenz-card p-3.5 text-left";

function QuickTile({ entry, ghost, notificationsOn }: { entry: SettingEntry; ghost: GhostState; notificationsOn: boolean }) {
  if (entry.id === "appearance.theme") return <DarkModeTile />;
  if (entry.id === "privacy.ghost") return <GhostTile initial={ghost} />;
  if (entry.id === "notifications.pause") return <PauseTile initiallyOn={notificationsOn} />;
  if (entry.id === "language.language") return <LanguageSettingRow variant="tile" />;
  // any other pin opens its own screen (or says why it can't)
  const category = getCategory(entry.category);
  const reachable = entry.status === "live" && !!entry.href;
  const body = (
    <>
      <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-frenz-fill text-frenz-violet">
        <Pin className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[15px] font-bold">{entry.label}</span>
        <span className="truncate text-xs text-frenz-muted">{category?.label ?? entry.description}</span>
      </span>
    </>
  );
  return reachable ? (
    <Link href={entry.href!} prefetch className={cn(TILE, "transition active:scale-[0.98]")}>
      {body}
    </Link>
  ) : (
    <div className={cn(TILE, "opacity-60")}>{body}</div>
  );
}

/** The design's switch: 50 × 30, the knob slides. A real role="switch" with its own name. */
function Switch({ on, label, busy, onToggle }: { on: boolean; label: string; busy?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={busy || undefined}
      onClick={onToggle}
      className="-m-[7px] flex h-11 w-16 shrink-0 items-center justify-center"
    >
      <span className={cn("flex h-[30px] w-[50px] rounded-full p-0.5 transition-colors", on ? "justify-end bg-frenz-violet" : "justify-start bg-[#E2DFEC] dark:bg-white/20")}>
        <span className="h-[26px] w-[26px] rounded-full bg-white shadow-[0_2px_4px_rgba(0,0,0,0.2)]" />
      </span>
    </button>
  );
}

function SwitchTile({ icon, iconClass, title, sub, on, label, busy, onToggle, error }: { icon: ReactNode; iconClass: string; title: string; sub: string; on: boolean; label: string; busy?: boolean; onToggle: () => void; error?: string | null }) {
  return (
    <div className={TILE}>
      <span className="flex items-center justify-between">
        <span aria-hidden className={cn("flex h-9 w-9 items-center justify-center rounded-[11px] text-white", iconClass)}>
          {icon}
        </span>
        <Switch on={on} label={label} busy={busy} onToggle={onToggle} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-bold">{title}</span>
        <span className={cn("truncate text-xs", error ? "text-rose-600 dark:text-rose-400" : "text-frenz-muted")} role={error ? "alert" : undefined}>
          {error ?? sub}
        </span>
      </span>
    </div>
  );
}

/** Dark mode: the same theme store the menu's Light / Dark / Auto uses (theme-mode-client). */
function DarkModeTile() {
  const { setTheme, resolvedTheme } = useTheme();
  const [mode, setMode] = useState<ThemeMode>(getCachedThemeMode());
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => subscribeThemeMode(setMode), []);
  const dark = mounted && resolvedTheme === "dark";
  const choose = (value: ThemeMode) => {
    haptic("selection");
    setThemeModeLocal(value);
    setTheme(value === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : value);
  };
  const sub = !mounted ? "" : mode === "system" ? `Auto · ${dark ? "on" : "off"} now` : dark ? "On" : "Off";
  return <SwitchTile icon={<Moon className="h-[18px] w-[18px]" />} iconClass="bg-frenz-ink dark:bg-white/15" title="Dark mode" sub={sub} on={dark} label="Dark mode" onToggle={() => choose(dark ? "light" : "dark")} />;
}

/** Ghost mode: every activity signal at once, through the Ghost Mode screen's own write path. */
function GhostTile({ initial }: { initial: GhostState }) {
  const { state, busy, error, apply } = useGhostMode(initial);
  const all = isFullyGhosted(state);
  const hidden = ghostedCount(state);
  const sub = all ? "All signals hidden" : hidden ? `${hidden} of ${GHOST_SIGNALS.length} signals hidden` : "Off";
  return (
    <SwitchTile
      icon={<Ghost className="h-[18px] w-[18px]" />}
      iconClass="bg-frenz-violet"
      title="Ghost mode"
      sub={sub}
      on={all}
      label="Ghost mode"
      busy={busy === "all"}
      error={error ? "Couldn't save. Try again." : null}
      onToggle={() => {
        haptic("selection");
        void apply(allSignals(!all), "all");
      }}
    />
  );
}

/** Pause alerts: notifications' master switch, the same field the Notifications screen saves. */
function PauseTile({ initiallyOn }: { initiallyOn: boolean }) {
  const [on, setOn] = useState(initiallyOn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    haptic("selection");
    const next = !on;
    // the switch answers on the tap; the server confirms or it goes back
    setOn(next);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/notification-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ masterEnabled: next }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setOn(!next);
      setError("Couldn't save. Try again.");
    }
  };
  return (
    <SwitchTile
      icon={<BellOff className="h-[18px] w-[18px]" />}
      iconClass="bg-frenz-magenta"
      title="Pause alerts"
      sub={on ? "Off" : "All notifications paused"}
      on={!on}
      label="Pause notifications"
      busy={busy}
      error={error}
      onToggle={() => void toggle()}
    />
  );
}
