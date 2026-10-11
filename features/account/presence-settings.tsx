"use client";

import {
  BookOpen,
  Briefcase,
  Car,
  Coffee,
  Gamepad2,
  History,
  Laptop,
  Loader2,
  Moon,
  Plane,
  Plus,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { myOnlineDevices, usePresence } from "@/features/friends/use-presence";
import { useStickyState } from "@/features/ui/use-sticky-state";
import { haptic } from "@/lib/motion/haptics";
import type { PresenceStatus } from "@/lib/social/presence-status";
import { setMyBroadcastLocal, setMyPresenceStatusLocal } from "@/lib/social/presence-status-client";
import {
  AUTO_REPLY_MAX,
  CUSTOM_STATUS_MAX,
  effectivePresence,
  EVERY_DAY,
  FOCUS_MODES,
  FOCUS_SPECS,
  nextLocalTime,
  OPEN_TO,
  OPEN_TO_LABEL,
  presenceLine,
  SCHEDULES_MAX,
  smartSuggestions,
  STATUS_PRESETS,
  WEEKDAYS,
  type FocusMode,
  type OpenTo,
  type PresenceSchedule,
} from "@/lib/social/presence/engine";
import type { OwnPresence } from "@/lib/social/presence/server";
import { cn } from "@/lib/utils";

/**
 * Presence (Feature 19 · Part 9) — status, focus, automations, and who sees them.
 *
 * Every control writes to the store that already owns it: the status row
 * (/api/presence-status, 0043 + 0224), automations (/api/presence/schedules),
 * and last seen (/api/privacy, 0060). Typing and read receipts stay in Ghost
 * Mode, linked from here, so there is one switch for each signal and never two.
 *
 * Nothing is applied for the member: Smart Availability offers, and a tap
 * applies. Expired statuses and scheduled modes are worked out when someone
 * looks, so there is no timer running on anyone's behalf.
 */

const STATUS_OPTIONS: { value: PresenceStatus; label: string; hint: string; dot: string }[] = [
  { value: "available", label: "Available", hint: "Shown as online as usual", dot: "bg-emerald-400" },
  { value: "away", label: "Away", hint: "Clears itself the moment you're back", dot: "bg-amber-400" },
  { value: "busy", label: "Busy", hint: "Still reachable, just heads-down", dot: "bg-rose-500" },
  { value: "dnd", label: "Do Not Disturb", hint: "No push notifications at all", dot: "bg-violet-500" },
  { value: "invisible", label: "Invisible", hint: "Never appear online to anyone", dot: "bg-muted-foreground/50" },
];

const FOCUS_ICON: Record<FocusMode, LucideIcon> = { work: Briefcase, study: BookOpen, meeting: Users, driving: Car, sleep: Moon, gaming: Gamepad2, personal: Coffee, vacation: Plane };
const DEVICE_ICON = { phone: Smartphone, tablet: Tablet, desktop: Laptop } as const;
const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const CARD = "overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm";
const H2 = "mb-2 px-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-muted-foreground";
const CHIP = "inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition disabled:opacity-60 active:scale-[0.97] motion-reduce:active:scale-100 touch-manipulation select-none";
const BTN = "inline-flex min-h-[2.5rem] items-center justify-center gap-1.5 rounded-full bg-foreground px-4 text-[13.5px] font-semibold text-background transition disabled:opacity-60 active:scale-[0.97] motion-reduce:active:scale-100 touch-manipulation select-none";
const QUIET = "inline-flex min-h-[2.5rem] items-center justify-center gap-1.5 rounded-full border border-border px-4 text-[13.5px] font-semibold transition hover:bg-secondary disabled:opacity-60 active:scale-[0.97] motion-reduce:active:scale-100 touch-manipulation select-none";
const INPUT = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
function daysLabel(days: number): string {
  if (days === EVERY_DAY) return "Every day";
  if (days === WEEKDAYS) return "Weekdays";
  if (days === 0b1000001) return "Weekends";
  return DAY_NAMES.filter((_, i) => days & (1 << i)).map((d) => d.slice(0, 3)).join(", ");
}
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const localTz = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

async function patchPresence(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/presence-status", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (res?.ok) return null;
  const j = (await res?.json().catch(() => null)) as { error?: string } | null;
  return j?.error ?? "Couldn't save that.";
}

export function PresenceSettings({ initial, userId }: { initial: OwnPresence; userId: string }) {
  // sticky: a back-swipe replays the cached payload, and the member's changes must survive it
  const [row, setRow] = useStickyState("pr-row", initial.loadedAt, initial.row);
  const [schedules, setSchedules] = useStickyState<PresenceSchedule[]>("pr-schedules", initial.loadedAt, initial.schedules);
  const [lastSeen, setLastSeen] = useStickyState("pr-lastseen", initial.loadedAt, initial.lastSeen);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(initial.ready ? null : "Focus modes, custom status and automations arrive with the next update. Your status below works today.");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const online = usePresence();

  // the member's local clock exists only in the browser (the server is UTC), so suggestions wait for mount
  const [clock, setClock] = useState<{ day: number; minute: number } | null>(null);
  useEffect(() => {
    const d = new Date();
    setClock({ day: d.getDay(), minute: d.getHours() * 60 + d.getMinutes() });
  }, []);
  const effective = useMemo(() => effectivePresence(row, schedules, new Date()), [row, schedules]);
  const line = presenceLine(effective);
  const suggestions = clock ? smartSuggestions({ ...clock, effective, schedules }).filter((s) => !dismissed.includes(s.id)) : [];
  // the live online set exists only in the browser: read it after mount (clock is set then) so hydration matches
  const devices = clock && online.has(userId) ? myOnlineDevices(userId) : [];

  /** Optimistic write: the row changes at once and goes back if the server says no. */
  const save = async (key: string, patch: Partial<typeof row>, body: Record<string, unknown>) => {
    const prev = row;
    haptic("selection");
    setRow({ ...row, ...patch });
    setBusy(key);
    setNote(null);
    const err = await patchPresence(body);
    setBusy(null);
    if (err) {
      setRow(prev);
      setNote(err);
      return false;
    }
    return true;
  };

  // ── status ──
  const chooseStatus = async (s: PresenceStatus) => {
    if (s === row.status) return;
    if (await save("status", { status: s }, { status: s })) setMyPresenceStatusLocal(s);
  };

  // ── focus ──
  const [pendingFocus, setPendingFocus] = useState<FocusMode | null>(null);
  const [useReply, setUseReply] = useState(false);
  const startFocus = async (mode: FocusMode, until: string | null) => {
    const reply = useReply ? FOCUS_SPECS[mode].reply : undefined;
    setPendingFocus(null);
    const ok = await save("focus", { focusMode: mode, focusUntil: until, ...(reply ? { autoReply: reply } : {}) }, { focusMode: mode, focusUntil: until, ...(reply ? { autoReply: reply } : {}) });
    if (ok) {
      setPendingFocus(null);
      setUseReply(false);
    }
  };
  const endFocus = () => void save("focus", { focusMode: null, focusUntil: null }, { focusMode: null });

  // ── custom status ──
  const [custom, setCustom] = useState(row.customText ?? "");
  const [clearAfter, setClearAfter] = useState<"never" | "1h" | "4h" | "today" | "week">("never");
  const customUntil = (): string | null => {
    const t = Date.now();
    if (clearAfter === "1h") return new Date(t + 3_600_000).toISOString();
    if (clearAfter === "4h") return new Date(t + 4 * 3_600_000).toISOString();
    if (clearAfter === "today") {
      const d = new Date();
      d.setHours(23, 59, 0, 0);
      return d.toISOString();
    }
    if (clearAfter === "week") return new Date(t + 7 * 86_400_000).toISOString();
    return null;
  };
  const saveCustom = () => {
    const text = custom.trim() || null;
    const until = text ? customUntil() : null;
    void save("custom", { customText: text, customUntil: until }, { customText: text, customUntil: until });
  };

  // ── auto reply ──
  const [reply, setReply] = useState(row.autoReply ?? "");

  // ── open to ──
  const toggleOpen = (o: OpenTo) => {
    const next = row.openTo.includes(o) ? row.openTo.filter((x) => x !== o) : [...row.openTo, o];
    void save(`open-${o}`, { openTo: next }, { openTo: next });
  };

  // ── audience ──
  const [circle, setCircle] = useState(row.audienceCircle ?? initial.circles[0]?.id ?? "");
  const setAudience = (a: string) => {
    if (a === "circle" && !circle) return setNote("Make a circle first, in Friends → Circles.");
    void save("audience", { audience: a, audienceCircle: a === "circle" ? circle : null }, { audience: a, audienceCircle: a === "circle" ? circle : null });
  };
  const setSeen = async (v: "everyone" | "friends" | "nobody") => {
    const prev = lastSeen;
    haptic("selection");
    setLastSeen(v);
    setBusy("seen");
    const res = await fetch("/api/privacy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ last_seen_visibility: v }) }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setLastSeen(prev);
      setNote("Couldn't save that.");
      return;
    }
    // leave or join the public online channel right away
    setMyBroadcastLocal(v === "everyone");
  };

  // ── automations ──
  const [draft, setDraft] = useState({ mode: "sleep" as FocusMode, days: EVERY_DAY, start: "23:00", end: "07:00" });
  const addSchedule = async (s?: { mode: FocusMode; days: number; startMin: number; endMin: number }) => {
    const body = s ?? { mode: draft.mode, days: draft.days, startMin: toMin(draft.start), endMin: toMin(draft.end) };
    if (!body.days) return setNote("Choose at least one day.");
    haptic("selection");
    const temp = `pending-${Date.now()}`;
    setSchedules((l) => [...l, { id: temp, ...body, tz: localTz(), enabled: true }]);
    const res = await fetch("/api/presence/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, tz: localTz(), enabled: true }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    if (!res?.ok || !j?.id) {
      setSchedules((l) => l.filter((x) => x.id !== temp));
      return setNote(j?.error ?? "Couldn't save that.");
    }
    setSchedules((l) => l.map((x) => (x.id === temp ? { ...x, id: j.id! } : x)));
  };
  const toggleSchedule = async (s: PresenceSchedule) => {
    if (s.id.startsWith("pending-")) return;
    haptic("selection");
    setSchedules((l) => l.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)));
    const res = await fetch("/api/presence/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, mode: s.mode, days: s.days, startMin: s.startMin, endMin: s.endMin, tz: s.tz, enabled: !s.enabled }) }).catch(() => null);
    if (!res?.ok) {
      setSchedules((l) => l.map((x) => (x.id === s.id ? s : x)));
      setNote("Couldn't save that.");
    }
  };
  const removeSchedule = async (s: PresenceSchedule) => {
    if (s.id.startsWith("pending-")) return;
    haptic("selection");
    setSchedules((l) => l.filter((x) => x.id !== s.id));
    const res = await fetch(`/api/presence/schedules?id=${s.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setSchedules((l) => [...l, s]);
      setNote("Couldn't remove that.");
    }
  };

  // ── smart availability ──
  const applySuggestion = (id: string) => {
    if (id === "sleep_now") void startFocus("sleep", nextLocalTime(new Date(), localTz(), 7));
    else if (id === "end_vacation") endFocus();
    else if (id === "work_schedule") void addSchedule({ mode: "work", days: WEEKDAYS, startMin: 9 * 60, endMin: 17 * 60 });
    setDismissed((d) => [...d, id]);
  };

  // ── history ──
  const [q, setQ] = useState("");
  const history = initial.history.filter((h) => !q || `${h.kind} ${h.value ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const historyLabel = (h: OwnPresence["history"][number]) =>
    h.kind === "status"
      ? `Status: ${STATUS_OPTIONS.find((o) => o.value === h.value)?.label ?? h.value}`
      : h.kind === "focus"
        ? h.value === "off" || !h.value ? "Focus ended" : `Focus: ${FOCUS_SPECS[h.value as FocusMode]?.label ?? h.value}`
        : h.value
          ? `Custom status: ${h.value}`
          : "Custom status cleared";

  const dot = STATUS_OPTIONS.find((o) => o.value === row.status)?.dot ?? "bg-emerald-400";
  const statusLabel = STATUS_OPTIONS.find((o) => o.value === row.status)?.label ?? "Available";

  return (
    <div className="space-y-7">
      {/* How people see you */}
      <section aria-labelledby="pr-preview" className={cn(CARD, "px-4 py-4")}>
        <h2 id="pr-preview" className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          How people see you
        </h2>
        <div className="mt-2.5 flex items-center gap-3">
          <span aria-hidden className={cn("h-3 w-3 shrink-0 rounded-full ring-4 ring-background transition-colors duration-300 motion-reduce:transition-none", dot)} />
          <div className="min-w-0">
            <p className="text-[17px] font-bold leading-tight">{line ?? statusLabel}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {effective.focus?.source === "schedule" ? "On by an automation. " : ""}
              {effective.holdsPush ? "Notifications are waiting. " : ""}
              {effective.autoReply ? `Auto reply: “${effective.autoReply}”` : ""}
              {!effective.focus && !effective.holdsPush && !effective.autoReply ? (row.audience === "nobody" ? "Your status details are private." : "Shown to the people you choose below.") : ""}
            </p>
          </div>
        </div>
      </section>

      <div aria-live="polite">{note ? <p className="rounded-2xl bg-secondary/60 px-3.5 py-2.5 text-[13px]">{note}</p> : null}</div>

      {/* Smart Availability */}
      {suggestions.length ? (
        <section aria-labelledby="pr-smart">
          <h2 id="pr-smart" className={H2}>
            Suggestions
          </h2>
          <ul className="space-y-2">
            {suggestions.map((s) => (
              <li key={s.id} className={cn(CARD, "flex items-start gap-3 px-3.5 py-3")}>
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold leading-snug">{s.title}</p>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">{s.line}</p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className={BTN} onClick={() => applySuggestion(s.id)} disabled={!initial.ready}>
                      Yes
                    </button>
                    <button type="button" className={QUIET} onClick={() => setDismissed((d) => [...d, s.id])}>
                      Not now
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Status */}
      <section aria-labelledby="pr-status">
        <h2 id="pr-status" className={H2}>
          Status
        </h2>
        <div role="radiogroup" aria-labelledby="pr-status" className={CARD}>
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={row.status === o.value}
              onClick={() => void chooseStatus(o.value)}
              className="flex w-full items-center gap-3 border-b border-border/60 px-3.5 py-3 text-left last:border-0 hover:bg-secondary/40 active:bg-secondary/70 touch-manipulation"
            >
              <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", o.dot)} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-semibold">{o.label}</span>
                <span className="block text-[12.5px] text-muted-foreground">{o.hint}</span>
              </span>
              <span aria-hidden className={cn("h-5 w-5 shrink-0 rounded-full border-2", row.status === o.value ? "border-primary bg-primary shadow-[inset_0_0_0_3px_hsl(var(--background))]" : "border-border")} />
            </button>
          ))}
        </div>
      </section>

      {/* Focus modes */}
      <section aria-labelledby="pr-focus">
        <h2 id="pr-focus" className={H2}>
          Focus
        </h2>
        {effective.focus ? (
          <div className={cn(CARD, "mb-2 flex items-center gap-3 px-3.5 py-3")}>
            {(() => {
              const Icon = FOCUS_ICON[effective.focus.mode];
              return (
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
              );
            })()}
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold">{FOCUS_SPECS[effective.focus.mode].label} is on</p>
              <p className="text-[12.5px] text-muted-foreground" suppressHydrationWarning>
                {effective.focus.source === "schedule" ? "Turned on by an automation." : effective.focus.until ? `Until ${fmtWhen(effective.focus.until)}` : "Until you end it."}
              </p>
            </div>
            {effective.focus.source === "manual" ? (
              <button type="button" className={QUIET} onClick={endFocus}>
                End
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-4">
          {FOCUS_MODES.map((m) => {
            const Icon = FOCUS_ICON[m];
            const on = effective.focus?.mode === m;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on || pendingFocus === m}
                onClick={() => setPendingFocus(pendingFocus === m ? null : m)}
                disabled={!initial.ready}
                className={cn(
                  "flex min-h-[4.5rem] touch-manipulation flex-col items-start justify-between rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.97] disabled:opacity-50 motion-reduce:active:scale-100",
                  on || pendingFocus === m ? "border-primary/50 bg-primary/[0.07]" : "border-border/70 bg-card hover:bg-secondary/40",
                )}
              >
                <Icon aria-hidden className={cn("h-[18px] w-[18px]", on ? "text-primary" : "text-muted-foreground")} />
                <span className="text-[13.5px] font-semibold">{FOCUS_SPECS[m].label}</span>
              </button>
            );
          })}
        </div>
        {pendingFocus ? (
          <div className={cn(CARD, "mt-2 px-3.5 py-3")}>
            <p className="text-[14px] font-semibold">{FOCUS_SPECS[pendingFocus].label}</p>
            <ul className="mt-1 space-y-0.5 text-[12.5px] text-muted-foreground">
              <li>People who can see your status see “{FOCUS_SPECS[pendingFocus].shownAs}”.</li>
              <li>{FOCUS_SPECS[pendingFocus].holdsPush ? "Push notifications wait until it ends. Everything is still in the app." : "Notifications arrive as usual."}</li>
            </ul>
            <label className="mt-2.5 flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={useReply} onChange={(e) => setUseReply(e.target.checked)} />
              <span>
                Use the auto reply “{FOCUS_SPECS[pendingFocus].reply}”
              </span>
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={BTN} onClick={() => void startFocus(pendingFocus, new Date(Date.now() + 3_600_000).toISOString())}>
                For an hour
              </button>
              <button type="button" className={QUIET} onClick={() => void startFocus(pendingFocus, nextLocalTime(new Date(), localTz(), 7))}>
                Until morning
              </button>
              <button type="button" className={QUIET} onClick={() => void startFocus(pendingFocus, null)}>
                Until I end it
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Custom status */}
      <section aria-labelledby="pr-custom">
        <h2 id="pr-custom" className={H2}>
          Custom status
        </h2>
        <div className={cn(CARD, "px-3.5 py-3")}>
          <label htmlFor="pr-custom-input" className="sr-only">
            Custom status
          </label>
          <input id="pr-custom-input" className={INPUT} value={custom} maxLength={CUSTOM_STATUS_MAX} placeholder="What are you up to?" onChange={(e) => setCustom(e.target.value)} disabled={!initial.ready} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {STATUS_PRESETS.map((p) => (
              <button key={p} type="button" className={cn(CHIP, custom === p ? "border-primary/50 bg-primary/[0.07]" : "border-border")} onClick={() => setCustom(p)} disabled={!initial.ready}>
                {p}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label htmlFor="pr-clear" className="text-[13px] text-muted-foreground">
              Clear after
            </label>
            <select id="pr-clear" className="min-h-[2.5rem] rounded-xl border border-border bg-background px-2.5 text-[14px]" value={clearAfter} onChange={(e) => setClearAfter(e.target.value as typeof clearAfter)}>
              <option value="never">Don&apos;t clear</option>
              <option value="1h">An hour</option>
              <option value="4h">Four hours</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
            </select>
            <span className="flex-1" />
            {row.customText ? (
              <button type="button" className={QUIET} onClick={() => { setCustom(""); void save("custom", { customText: null, customUntil: null }, { customText: null }); }}>
                Clear
              </button>
            ) : null}
            <button type="button" className={BTN} disabled={busy === "custom" || !initial.ready || custom.trim() === (row.customText ?? "")} onClick={saveCustom}>
              {busy === "custom" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Save
            </button>
          </div>
        </div>
      </section>

      {/* Auto reply (Smart Reply Status) */}
      <section aria-labelledby="pr-reply">
        <h2 id="pr-reply" className={H2}>
          Auto reply
        </h2>
        <div className={cn(CARD, "px-3.5 py-3")}>
          <label htmlFor="pr-reply-input" className="sr-only">
            Auto reply
          </label>
          <textarea id="pr-reply-input" rows={2} className={cn(INPUT, "resize-none")} value={reply} maxLength={AUTO_REPLY_MAX} placeholder="I'll reply later." onChange={(e) => setReply(e.target.value)} disabled={!initial.ready} />
          <p className="mt-1.5 text-[12.5px] text-muted-foreground">Shown at the top of a chat with you while a focus or custom status is on, or you&apos;re Busy. It is never sent as a message.</p>
          <div className="mt-2.5 flex justify-end gap-2">
            {row.autoReply ? (
              <button type="button" className={QUIET} onClick={() => { setReply(""); void save("reply", { autoReply: null }, { autoReply: null }); }}>
                Turn off
              </button>
            ) : null}
            <button type="button" className={BTN} disabled={busy === "reply" || !initial.ready || reply.trim() === (row.autoReply ?? "")} onClick={() => void save("reply", { autoReply: reply.trim() || null }, { autoReply: reply.trim() || null })}>
              Save
            </button>
          </div>
        </div>
      </section>

      {/* Social availability */}
      <section aria-labelledby="pr-open">
        <h2 id="pr-open" className={H2}>
          Open to
        </h2>
        <div className="flex flex-wrap gap-2">
          {OPEN_TO.map((o) => {
            const on = row.openTo.includes(o);
            return (
              <button key={o} type="button" aria-pressed={on} className={cn(CHIP, on ? "border-primary/50 bg-primary/[0.08] text-primary" : "border-border bg-card")} onClick={() => toggleOpen(o)} disabled={!initial.ready}>
                {OPEN_TO_LABEL[o]}
              </button>
            );
          })}
        </div>
      </section>

      {/* Presence Automation */}
      <section aria-labelledby="pr-auto">
        <h2 id="pr-auto" className={H2}>
          Automations
        </h2>
        <div className={CARD}>
          {schedules.length ? (
            <ul>
              {schedules.map((s) => {
                const Icon = FOCUS_ICON[s.mode];
                return (
                  <li key={s.id} className="flex items-center gap-3 border-b border-border/60 px-3.5 py-3">
                    <Icon aria-hidden className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold">{FOCUS_SPECS[s.mode].label}</span>
                      <span className="block text-[12.5px] text-muted-foreground">
                        {daysLabel(s.days)} · {s.startMin === s.endMin ? "all day" : `${hhmm(s.startMin)} to ${hhmm(s.endMin)}`}
                      </span>
                    </span>
                    <button type="button" role="switch" aria-checked={s.enabled} aria-label={`${FOCUS_SPECS[s.mode].label} automation`} onClick={() => void toggleSchedule(s)} className={cn("relative h-6 w-11 shrink-0 touch-manipulation rounded-full transition", s.enabled ? "bg-primary" : "bg-muted")}>
                      <span aria-hidden className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none", s.enabled ? "left-[1.375rem]" : "left-0.5")} />
                    </button>
                    <button type="button" aria-label={`Remove the ${FOCUS_SPECS[s.mode].label} automation`} onClick={() => void removeSchedule(s)} className="inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-muted-foreground hover:bg-secondary active:bg-secondary">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="border-b border-border/60 px-3.5 py-3 text-[13px] text-muted-foreground">Turn a focus on by itself, on the days and hours you choose. Nothing runs in the background: it simply applies while the time is right.</p>
          )}
          {schedules.length < SCHEDULES_MAX ? (
            <div className="px-3.5 py-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[12.5px] text-muted-foreground">
                  Focus
                  <select className="mt-1 block min-h-[2.5rem] rounded-xl border border-border bg-background px-2.5 text-[14px] text-foreground" value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as FocusMode })}>
                    {FOCUS_MODES.map((m) => (
                      <option key={m} value={m}>
                        {FOCUS_SPECS[m].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[12.5px] text-muted-foreground">
                  From
                  <input type="time" className="mt-1 block min-h-[2.5rem] rounded-xl border border-border bg-background px-2.5 text-[14px] text-foreground" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
                </label>
                <label className="text-[12.5px] text-muted-foreground">
                  To
                  <input type="time" className="mt-1 block min-h-[2.5rem] rounded-xl border border-border bg-background px-2.5 text-[14px] text-foreground" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
                </label>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Days">
                {DAY_LETTERS.map((d, i) => {
                  const on = (draft.days & (1 << i)) !== 0;
                  return (
                    <button key={i} type="button" aria-pressed={on} aria-label={DAY_NAMES[i]} onClick={() => setDraft({ ...draft, days: draft.days ^ (1 << i) })} className={cn("h-10 w-10 touch-manipulation rounded-full border text-[13px] font-semibold transition active:scale-95 motion-reduce:active:scale-100", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                      {d}
                    </button>
                  );
                })}
                <span className="flex-1" />
                <button type="button" className={BTN} onClick={() => void addSchedule()} disabled={!initial.ready}>
                  <Plus className="h-4 w-4" aria-hidden /> Add
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Who sees it */}
      <section aria-labelledby="pr-who">
        <h2 id="pr-who" className={H2}>
          Who sees it
        </h2>
        <div className={cn(CARD, "px-3.5 py-3")}>
          <fieldset>
            <legend className="text-[14px] font-semibold">Your status, focus and auto reply</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(
                [
                  ["everyone", "Everyone"],
                  ["friends", "Friends"],
                  ["circle", "One circle"],
                  ["nobody", "Nobody"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" aria-pressed={row.audience === v} className={cn(CHIP, row.audience === v ? "border-primary/50 bg-primary/[0.08] text-primary" : "border-border")} onClick={() => setAudience(v)} disabled={!initial.ready}>
                  {l}
                </button>
              ))}
            </div>
            {row.audience === "circle" || initial.circles.length ? (
              <label className="mt-2 block text-[12.5px] text-muted-foreground">
                Circle
                <select
                  className="mt-1 block min-h-[2.5rem] w-full rounded-xl border border-border bg-background px-2.5 text-[14px] text-foreground"
                  value={circle}
                  onChange={(e) => {
                    setCircle(e.target.value);
                    if (row.audience === "circle") void save("audience", { audienceCircle: e.target.value }, { audience: "circle", audienceCircle: e.target.value });
                  }}
                >
                  {initial.circles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </fieldset>
          <fieldset className="mt-4 border-t border-border/60 pt-3">
            <legend className="text-[14px] font-semibold">Online and last seen</legend>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(
                [
                  ["everyone", "Everyone"],
                  ["friends", "Friends"],
                  ["nobody", "Nobody"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" aria-pressed={lastSeen === v} className={cn(CHIP, lastSeen === v ? "border-primary/50 bg-primary/[0.08] text-primary" : "border-border")} onClick={() => void setSeen(v)}>
                  {l}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">
              {lastSeen === "everyone" ? "Anyone can see when you're online." : lastSeen === "friends" ? "Friends see when you were last active. You don't appear on the public online list." : "Nobody sees when you're online or were last active."}
            </p>
          </fieldset>
          <p className="mt-3 border-t border-border/60 pt-3 text-[13px]">
            Typing and read receipts are in{" "}
            <Link href="/account/ghost" prefetch={false} className="font-semibold text-primary underline-offset-2 hover:underline">
              Ghost Mode
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Cross-Platform Presence (yours only) */}
      <section aria-labelledby="pr-devices">
        <h2 id="pr-devices" className={H2}>
          Where you&apos;re online
        </h2>
        <div className={cn(CARD, "px-3.5 py-3")}>
          {devices.length ? (
            <ul className="flex flex-wrap gap-2">
              {devices.map((d) => {
                const Icon = DEVICE_ICON[d];
                return (
                  <li key={d} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
                    <Icon className="h-4 w-4" aria-hidden /> {d === "phone" ? "Phone" : d === "tablet" ? "Tablet" : "Computer"}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">{row.status === "invisible" ? "You're invisible, so no device shows you online." : lastSeen !== "everyone" ? "You're not on the public online list, so no device announces you." : "Connecting…"}</p>
          )}
          <p className="mt-2 text-[12.5px] text-muted-foreground">One status everywhere: a change here reaches every device at once. Only you see this list.</p>
        </div>
      </section>

      {/* Presence history */}
      <section aria-labelledby="pr-history">
        <h2 id="pr-history" className={H2}>
          History
        </h2>
        <div className={CARD}>
          <div className="flex items-center gap-2 border-b border-border/60 px-3.5 py-2.5">
            <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <label htmlFor="pr-history-q" className="sr-only">
              Search your history
            </label>
            <input id="pr-history-q" className="min-h-[2.25rem] flex-1 bg-transparent text-[14px] outline-none" placeholder="Search your history" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {history.length ? (
            <ul className="max-h-80 overflow-y-auto">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex items-baseline justify-between gap-3 border-b border-border/60 px-3.5 py-2.5 text-[13.5px] last:border-0">
                  <span className="min-w-0 truncate">{historyLabel(h)}</span>
                  <time dateTime={h.at} className="shrink-0 text-[12px] text-muted-foreground" suppressHydrationWarning>
                    {fmtWhen(h.at)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3.5 py-3 text-[13px] text-muted-foreground">{q ? "Nothing matches." : "Changes to your status, focus and custom status appear here. Only you see them, for 90 days."}</p>
          )}
        </div>
      </section>
    </div>
  );
}
