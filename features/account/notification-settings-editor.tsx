"use client";

import { Bell, BellOff, Download, EyeOff, Loader2, Mail, MessageCircle, Moon, Newspaper, ShieldCheck, Sparkles, Users2, Wrench } from "lucide-react";
import { useState } from "react";

import type { CategoryPref, NotificationSettings } from "@/lib/social/notification-settings";
import type { NotificationCategory } from "@/lib/social/notifications";
import { cn } from "@/lib/utils";

const CATEGORY_META: Record<NotificationCategory, { label: string; icon: typeof Bell }> = {
  social: { label: "Social (likes, comments, follows, messages)", icon: Users2 },
  downloads: { label: "Downloads", icon: Download },
  community: { label: "Communities", icon: MessageCircle },
  news: { label: "News", icon: Newspaper },
  premium: { label: "Premium & billing", icon: Sparkles },
  security: { label: "Security", icon: ShieldCheck },
  system: { label: "System & announcements", icon: Wrench },
};
const CATEGORIES = Object.keys(CATEGORY_META) as NotificationCategory[];
const DEFAULT_PREF: CategoryPref = { enabled: true, push: true };

/** Local-clock hour (0-23) ↔ UTC hour — the server has no reliable timezone
 * for a background push send, so the browser does this conversion once at
 * save/load time (see notification-settings.ts's column comment). */
function utcHourToLocal(h: number): number {
  return (h - new Date().getTimezoneOffset() / 60 + 24) % 24;
}
function localHourToUtc(h: number): number {
  return (h + new Date().getTimezoneOffset() / 60 + 24) % 24;
}
function hourLabel(h: number): string {
  const d = new Date();
  d.setHours(Math.round(h), 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Notification Settings (Part 6) — master switch, push/in-app channel
 * toggles, per-category enable+push, one quiet-hours window, and a
 * push-preview-privacy toggle. Embedded on /account like HomeModulesEditor
 * (same batched Save pattern), fetching `initial` server-side so the page
 * still renders instantly.
 *
 * Deliberately not built here (documented, not silently skipped): custom
 * sound packs / volume / haptic patterns — the existing "Interaction
 * sounds" popover in the inbox (NotificationSettingsPicker) already covers
 * foreground sound, and neither iOS nor Android lets a web app set the OS
 * push sound at all; unlimited named quiet-hours schedules (Sleep/Work/
 * Gym/...) — one real window is the honest, buildable core of "quiet
 * hours"; visual customization (card shape/avatar size/animation
 * intensity/badge color) — decorative-only, would touch every notification
 * surface for no functional gain.
 */
export function NotificationSettingsEditor({ initial }: { initial: NotificationSettings }) {
  const [settings, setSettings] = useState<NotificationSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const patchCategory = (category: NotificationCategory, patch: Partial<CategoryPref>) => {
    setSettings((prev) => ({
      ...prev,
      categoryPrefs: {
        ...prev.categoryPrefs,
        [category]: { ...(prev.categoryPrefs[category] ?? DEFAULT_PREF), ...patch },
      },
    }));
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/notification-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setMsg(res.ok ? { ok: true, text: "Notification settings saved." } : { ok: false, text: "Couldn't save." });
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="notifications" className="scroll-mt-24 border-b border-border/60 p-6 sm:p-8">
      <div className="mb-1 flex items-center gap-2">
        {settings.masterEnabled ? <Bell className="h-5 w-5 text-primary" /> : <BellOff className="h-5 w-5 text-muted-foreground" />}
        <h2 className="text-base font-semibold">Notifications</h2>
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        Control what reaches you, where, and when. Syncs across every device the moment you save.
      </p>

      <Toggle
        title="All notifications"
        desc="Turn everything below off at once"
        on={settings.masterEnabled}
        onToggle={() => setSettings((p) => ({ ...p, masterEnabled: !p.masterEnabled }))}
      />

      <div className={cn("mt-3 space-y-3", !settings.masterEnabled && "pointer-events-none opacity-40")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            title="Push notifications"
            desc="Alerts on this device, even when Frenz is closed"
            on={settings.pushEnabled}
            onToggle={() => setSettings((p) => ({ ...p, pushEnabled: !p.pushEnabled }))}
          />
          <Toggle
            title="In-app notifications"
            desc="The bell, toasts, and Notification Center"
            on={settings.inAppEnabled}
            onToggle={() => setSettings((p) => ({ ...p, inAppEnabled: !p.inAppEnabled }))}
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground">By category</p>
          <div className="space-y-2">
            {CATEGORIES.map((c) => {
              const pref = settings.categoryPrefs[c] ?? DEFAULT_PREF;
              const meta = CATEGORY_META[c];
              const locked = c === "security"; // always-on floor, matches quiet-hours bypass below
              return (
                <div key={c} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/15 p-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                    <meta.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium">{meta.label}</span>
                  {locked ? (
                    <span className="shrink-0 text-[11px] font-medium text-muted-foreground">Always on</span>
                  ) : (
                    <>
                      <MiniToggle label="Show" checked={pref.enabled} onChange={(v) => patchCategory(c, { enabled: v })} />
                      <MiniToggle label="Push" checked={pref.push} onChange={(v) => patchCategory(c, { push: v })} />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-secondary/15 p-3.5">
          <button
            type="button"
            onClick={() => setSettings((p) => ({ ...p, quietHoursEnabled: !p.quietHoursEnabled }))}
            aria-pressed={settings.quietHoursEnabled}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                <Moon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">Quiet hours</span>
                <span className="block text-xs text-muted-foreground">Hold back push during this window — security alerts still get through</span>
              </span>
            </span>
            <SwitchDot on={settings.quietHoursEnabled} />
          </button>
          {settings.quietHoursEnabled ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
              <TimeField
                label="From"
                valueHour={Math.round(utcHourToLocal(settings.quietHoursStartUtc))}
                onChange={(h) => setSettings((p) => ({ ...p, quietHoursStartUtc: Math.round(localHourToUtc(h)) }))}
              />
              <TimeField
                label="Until"
                valueHour={Math.round(utcHourToLocal(settings.quietHoursEndUtc))}
                onChange={(h) => setSettings((p) => ({ ...p, quietHoursEndUtc: Math.round(localHourToUtc(h)) }))}
              />
            </div>
          ) : null}
        </div>

        <Toggle
          icon={EyeOff}
          title="Hide message previews in push"
          desc={'Push shows "New message" instead of the actual text'}
          on={settings.hidePushPreview}
          onToggle={() => setSettings((p) => ({ ...p, hidePushPreview: !p.hidePushPreview }))}
        />

        <Toggle
          icon={Mail}
          title="Daily digest"
          desc="One daily summary — new followers, comments, friend requests, finished downloads — only sent when there's something to report"
          on={settings.digestEnabled}
          onToggle={() => setSettings((p) => ({ ...p, digestEnabled: !p.digestEnabled }))}
        />
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </button>
        {msg ? <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
      </div>
    </div>
  );
}

function Toggle({
  icon: Icon,
  title,
  desc,
  on,
  onToggle,
}: {
  icon?: typeof Bell;
  title: string;
  desc: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border/60 bg-secondary/15 p-3.5 text-left transition hover:border-foreground/15"
    >
      <span className="flex items-center gap-3">
        {Icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{desc}</span>
        </span>
      </span>
      <SwitchDot on={on} />
    </button>
  );
}

function SwitchDot({ on }: { on: boolean }) {
  return (
    <span className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors", on ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border")}>
      <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform", on ? "translate-x-6" : "translate-x-1")} />
    </span>
  );
}

function MiniToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cn("shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition", checked ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground")}
    >
      {label}
    </button>
  );
}

function TimeField({ label, valueHour, onChange }: { label: string; valueHour: number; onChange: (h: number) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      <select
        value={valueHour}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-lg border border-border/60 bg-background px-2 py-1.5 text-sm font-medium text-foreground"
      >
        {Array.from({ length: 24 }).map((_, h) => (
          <option key={h} value={h}>
            {hourLabel(h)}
          </option>
        ))}
      </select>
    </label>
  );
}
