/**
 * Universal Presence Engine™ — the pure rules (Feature 19 · Part 9).
 *
 * ── One row, derived at read time ─────────────────────────────────────────
 * Presence already had a home: `user_presence_status` (0043) holds the manual
 * status, `privacy_settings.last_seen_visibility` (0060) decides who sees you
 * online, and the shared Realtime channel (features/friends/use-presence.ts)
 * says who is connected. Part 9 adds to THAT row (0224): a custom status, a
 * Focus Mode, an auto reply, what you are open to, and who may see all of it.
 *
 * Nothing here runs on a timer. A status that "clears after an hour" stores
 * the hour and is ignored once it has passed; an automation ("Sleep, every
 * night 23:00 to 07:00") stores the window and is evaluated when someone
 * reads your presence. No cron flips a flag while nobody is looking, so
 * presence costs nothing for a member who is not using the app.
 *
 * ── Suggest, never apply ──────────────────────────────────────────────────
 * Smart Availability is a few transparent rules over the member's OWN clock
 * and settings ("it's late, turn on Sleep?"). It never reads anyone else, and
 * nothing it suggests is shown to anyone until the member taps it.
 *
 * Pure: no React, no Supabase, no I/O.
 */

import type { PresenceStatus } from "@/lib/social/presence-status";

export const FOCUS_MODES = ["work", "study", "meeting", "driving", "sleep", "gaming", "personal", "vacation"] as const;
export type FocusMode = (typeof FOCUS_MODES)[number];

export interface FocusSpec {
  key: FocusMode;
  label: string;
  /** What other people see while it is on. */
  shownAs: string;
  /** Pushes wait (in-app delivery still happens), exactly like Do Not Disturb. */
  holdsPush: boolean;
  /** Offered as the auto reply when the member turns the mode on. Never sent unless they keep it. */
  reply: string;
}

export const FOCUS_SPECS: Record<FocusMode, FocusSpec> = {
  work: { key: "work", label: "Work", shownAs: "Working", holdsPush: false, reply: "I'm working right now. I'll reply later." },
  study: { key: "study", label: "Study", shownAs: "Studying", holdsPush: false, reply: "Studying right now. I'll reply later." },
  meeting: { key: "meeting", label: "Meeting", shownAs: "In a meeting", holdsPush: true, reply: "In a meeting. I'll reply after." },
  driving: { key: "driving", label: "Driving", shownAs: "Driving", holdsPush: true, reply: "Driving. I'll reply when I stop." },
  sleep: { key: "sleep", label: "Sleep", shownAs: "Sleeping", holdsPush: true, reply: "Sleeping. I'll reply in the morning." },
  gaming: { key: "gaming", label: "Gaming", shownAs: "Gaming", holdsPush: false, reply: "Gaming. I'll reply after this round." },
  personal: { key: "personal", label: "Personal time", shownAs: "Personal time", holdsPush: true, reply: "Taking some personal time. I'll reply later." },
  vacation: { key: "vacation", label: "Vacation", shownAs: "On vacation", holdsPush: true, reply: "On vacation. I'll reply when I'm back." },
};

export function isFocusMode(v: unknown): v is FocusMode {
  return typeof v === "string" && (FOCUS_MODES as readonly string[]).includes(v);
}

/** Social availability: what a member is open to right now. */
export const OPEN_TO = ["chat", "collaboration", "business", "friend_requests", "mentorship"] as const;
export type OpenTo = (typeof OPEN_TO)[number];
export const OPEN_TO_LABEL: Record<OpenTo, string> = {
  chat: "Available to chat",
  collaboration: "Open to collaborate",
  business: "Available for business",
  friend_requests: "Accepting friend requests",
  mentorship: "Open to mentoring",
};

/** Who sees the status details (custom text, focus, auto reply, open to). Online and last seen keep their own setting. */
export const STATUS_AUDIENCES = ["everyone", "friends", "circle", "nobody"] as const;
export type StatusAudience = (typeof STATUS_AUDIENCES)[number];

export const CUSTOM_STATUS_MAX = 60;
export const AUTO_REPLY_MAX = 140;
export const SCHEDULES_MAX = 12;

export const STATUS_PRESETS = ["Working", "Studying", "Traveling", "Available later", "Creating", "Recording", "In focus mode", "At an event"] as const;

// ─── Schedules (Presence Automation™) ────────────────────────────────────────

export interface PresenceSchedule {
  id: string;
  mode: FocusMode;
  /** Bit 0 = Sunday … bit 6 = Saturday. */
  days: number;
  /** Minutes after local midnight. start > end crosses midnight (it belongs to the day it starts). start = end is all day. */
  startMin: number;
  endMin: number;
  tz: string;
  enabled: boolean;
}

export const WEEKDAYS = 0b0111110;
export const EVERY_DAY = 0b1111111;

/** The weekday (0 = Sunday) and minute of the day in a time zone. An unknown zone is UTC. */
export function localClock(now: Date, tz: string): { day: number; minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    return { day: now.getUTCDay(), minute: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const minute = (Number(get("hour")) % 24) * 60 + Number(get("minute"));
  return { day: day < 0 ? now.getUTCDay() : day, minute };
}

export function scheduleActive(s: PresenceSchedule, now: Date): boolean {
  if (!s.enabled || !(s.days & EVERY_DAY)) return false;
  const { day, minute } = localClock(now, s.tz);
  const on = (d: number) => (s.days & (1 << ((d + 7) % 7))) !== 0;
  if (s.startMin === s.endMin) return on(day);
  if (s.startMin < s.endMin) return on(day) && minute >= s.startMin && minute < s.endMin;
  // crosses midnight: tonight's part, or the morning after yesterday's start
  return (on(day) && minute >= s.startMin) || (on(day - 1) && minute < s.endMin);
}

// ─── The effective presence ──────────────────────────────────────────────────

export interface PresenceRow {
  status: PresenceStatus;
  customText: string | null;
  customUntil: string | null;
  focusMode: string | null;
  focusUntil: string | null;
  autoReply: string | null;
  openTo: string[];
  audience: string;
}

export interface EffectivePresence {
  status: PresenceStatus;
  focus: { mode: FocusMode; source: "manual" | "schedule"; until: string | null } | null;
  customText: string | null;
  autoReply: string | null;
  openTo: OpenTo[];
  /** Pushes wait: Do Not Disturb, or a focus mode that holds them. */
  holdsPush: boolean;
}

const notPast = (iso: string | null, now: Date) => !iso || Date.parse(iso) > now.getTime();

/** What is TRUE now: expired parts drop out, and an active schedule fills in when no focus was chosen by hand. */
export function effectivePresence(row: PresenceRow, schedules: readonly PresenceSchedule[], now: Date): EffectivePresence {
  let focus: EffectivePresence["focus"] = null;
  if (isFocusMode(row.focusMode) && notPast(row.focusUntil, now)) focus = { mode: row.focusMode, source: "manual", until: row.focusUntil };
  else {
    const s = schedules.find((x) => scheduleActive(x, now));
    if (s) focus = { mode: s.mode, source: "schedule", until: null };
  }
  const customText = row.customText && notPast(row.customUntil, now) ? row.customText : null;
  // an auto reply belongs to an away moment: it answers only while a focus or a custom status is on
  const autoReply = row.autoReply && (focus || customText || row.status === "busy" || row.status === "dnd") ? row.autoReply : null;
  return {
    status: row.status,
    focus,
    customText,
    autoReply,
    openTo: row.openTo.filter((o): o is OpenTo => (OPEN_TO as readonly string[]).includes(o)),
    holdsPush: row.status === "dnd" || (focus ? FOCUS_SPECS[focus.mode].holdsPush : false),
  };
}

/** One short line for other people: the focus, else the custom status, else a manual status worth saying. No digits, no timestamps. */
export function presenceLine(p: Pick<EffectivePresence, "status" | "focus" | "customText">): string | null {
  if (p.focus) return FOCUS_SPECS[p.focus.mode].shownAs;
  if (p.customText) return p.customText;
  if (p.status === "busy") return "Busy";
  if (p.status === "dnd") return "Do not disturb";
  if (p.status === "away") return "Away";
  return null;
}

/** May this viewer see the status details? The circle check is the owner's own circle (0112), never the viewer's. */
export function audienceAllows(audience: string, rel: { self: boolean; friend: boolean; inCircle: boolean }): boolean {
  if (rel.self) return true;
  if (audience === "nobody") return false;
  if (audience === "friends") return rel.friend;
  if (audience === "circle") return rel.inCircle;
  return true;
}

// ─── Smart Availability™ ─────────────────────────────────────────────────────

export interface AvailabilitySuggestion {
  id: "sleep_now" | "work_schedule" | "end_vacation";
  title: string;
  line: string;
}

/**
 * At most two suggestions, from the member's own local clock and settings.
 * Every one is an offer: the page applies it only on a tap.
 */
export function smartSuggestions(input: { day: number; minute: number; effective: EffectivePresence; schedules: readonly PresenceSchedule[] }): AvailabilitySuggestion[] {
  const out: AvailabilitySuggestion[] = [];
  const hour = Math.floor(input.minute / 60);
  const { focus } = input.effective;
  if (!focus && (hour >= 22 || hour < 5)) {
    out.push({ id: "sleep_now", title: "It's late. Turn on Sleep?", line: "Notifications wait until 7 in the morning, and friends see that you're sleeping." });
  }
  if (focus?.mode === "vacation" && focus.source === "manual" && !focus.until) {
    out.push({ id: "end_vacation", title: "Still on vacation?", line: "Vacation stays on until you end it." });
  }
  const weekday = input.day >= 1 && input.day <= 5;
  if (out.length < 2 && weekday && hour >= 8 && hour < 18 && !input.schedules.some((s) => s.mode === "work")) {
    out.push({ id: "work_schedule", title: "Set your working hours?", line: "Work turns on by itself on weekdays from 9 to 5, and off again after." });
  }
  return out.slice(0, 2);
}

/** "Until 07:00 tomorrow" style end for a focus started now, as an ISO time. `hour` is the member's local hour to end at. */
export function nextLocalTime(now: Date, tz: string, hour: number): string {
  const { minute } = localClock(now, tz);
  let delta = hour * 60 - minute;
  if (delta <= 0) delta += 24 * 60;
  const d = new Date(now.getTime() + delta * 60_000);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}
