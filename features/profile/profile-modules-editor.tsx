"use client";

import {
  Award,
  BadgeCheck,
  Bookmark,
  BookOpen,
  Briefcase,
  CalendarDays,
  Clapperboard,
  Clock,
  Crown,
  Download,
  FileText,
  FolderHeart,
  GitBranch,
  GraduationCap,
  Grid3x3,
  Heart,
  IdCard,
  LayoutGrid,
  Loader2,
  Package,
  Pin,
  Repeat2,
  Sparkles,
  Star,
  Trophy,
  Users,
  Wrench,
  ArrowDown,
  ArrowUp,
  Check,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SETTINGS_TINTS } from "@/features/account/settings-ui";
import type { EffectiveModule } from "@/lib/profile/engine";
import { AUDIENCES, modulesForType, type AudienceKey, type ModuleKey } from "@/lib/profile/modules";
import type { ProfileTypeKey } from "@/lib/profile/profile-types";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  Grid3x3,
  Clapperboard,
  Download,
  FolderHeart,
  Repeat2,
  Heart,
  Bookmark,
  IdCard,
  Trophy,
  LayoutGrid,
  Briefcase,
  GraduationCap,
  BadgeCheck,
  Award,
  BookOpen,
  Sparkles,
  FileText,
  Package,
  Wrench,
  Clock,
  Pin,
  Crown,
  CalendarDays,
  Star,
  Users,
  GitBranch,
};

interface Row {
  key: ModuleKey;
  label: string;
  blurb: string;
  icon: string;
  tint: string;
  enabled: boolean;
  audience: AudienceKey;
  governedElsewhere: boolean;
}

/**
 * Smart Profile Modules™ (Feature 18 · Part 14).
 *
 * Reordering is arrow buttons, not drag-and-drop. That is a deliberate
 * accessibility call: a drag handle is unusable with a keyboard or a screen
 * reader without building a parallel keyboard interface anyway, and it is
 * unreliable on touch inside a scrolling page — the exact place this list
 * lives. Up/down buttons work identically for every input method, announce
 * themselves, and cannot be "dropped" in the wrong place.
 *
 * The whole layout saves in one PUT because order is a property of the list,
 * not of any single row.
 */
export function ProfileModulesEditor({
  type,
  modules,
  landing,
}: {
  type: ProfileTypeKey;
  modules: EffectiveModule[];
  landing: ModuleKey | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() =>
    modules.map((m) => ({
      key: m.key,
      label: m.spec.label,
      blurb: m.spec.blurb,
      icon: m.spec.icon,
      tint: m.spec.tint,
      enabled: m.enabled,
      audience: m.audience,
      governedElsewhere: m.spec.governedElsewhere === true,
    })),
  );
  const [landingKey, setLandingKey] = useState<ModuleKey | null>(landing);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Modules this type offers but the platform can't serve yet — shown so the
  // roadmap is visible, never switchable.
  const planned = modulesForType(type).filter((m) => m.status === "planned");

  const touch = () => {
    setDirty(true);
    setMsg(null);
  };

  const toggle = (key: ModuleKey) => {
    touch();
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, enabled: !r.enabled } : r)));
    // Landing on a section you just switched off would send visitors nowhere.
    if (landingKey === key) setLandingKey(null);
  };

  const setAudience = (key: ModuleKey, audience: AudienceKey) => {
    touch();
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, audience } : r)));
  };

  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= rows.length) return;
    touch();
    setRows((rs) => {
      const next = [...rs];
      const [item] = next.splice(index, 1);
      next.splice(to, 0, item!);
      return next;
    });
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modules: rows.map((r) => ({ key: r.key, enabled: r.enabled, audience: r.audience })),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Couldn't save your sections." });
        return;
      }
      // The landing section rides on the profile row, so it's a second call —
      // but only when it actually changed.
      if (landingKey !== landing) {
        await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ landing_module: landingKey }),
        });
      }
      setDirty(false);
      setMsg({ ok: true, text: "Saved." });
      router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const enabled = rows.filter((r) => r.enabled);

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="divide-y divide-border/60">
          {rows.map((r, i) => {
            const Icon = ICONS[r.icon] ?? Grid3x3;
            return (
              <div key={r.key} className="px-3.5 py-3">
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
                      r.enabled ? (SETTINGS_TINTS[r.tint] ?? SETTINGS_TINTS.slate) : "bg-secondary text-muted-foreground ring-border/60",
                    )}
                  >
                    <Icon className="h-[19px] w-[19px]" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{r.label}</p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{r.blurb}</p>
                  </div>

                  {/* Reorder — keyboard- and screen-reader-equivalent to dragging */}
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Move ${r.label} up`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(i, 1)}
                      disabled={i === rows.length - 1}
                      aria-label={`Move ${r.label} down`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={r.enabled}
                      aria-label={`Show ${r.label} on your profile`}
                      onClick={() => toggle(r.key)}
                      className={cn(
                        "relative ml-1 h-6 w-11 shrink-0 rounded-full transition",
                        r.enabled ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                          r.enabled ? "left-[22px]" : "left-0.5",
                        )}
                      />
                    </button>
                  </div>
                </div>

                {/* Audience — only meaningful for a section that's actually shown */}
                {r.enabled ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-[52px]">
                    {r.governedElsewhere ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Lock className="h-3 w-3" />
                        Who sees this is set in Privacy
                      </span>
                    ) : (
                      AUDIENCES.map((a) => (
                        <button
                          key={a.key}
                          type="button"
                          onClick={() => setAudience(r.key, a.key)}
                          aria-pressed={r.audience === a.key}
                          title={a.blurb}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                            r.audience === a.key
                              ? "bg-brand-tile text-white shadow-sm"
                              : "bg-secondary/60 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {a.label}
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Landing section — the honest answer to "recruiters should see my portfolio" */}
      <section className="mt-5">
        <p className="px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Landing section</p>
        <p className="mt-0.5 px-1.5 text-xs text-muted-foreground">
          What visitors see first. Pick the section that makes your case.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              touch();
              setLandingKey(null);
            }}
            aria-pressed={landingKey === null}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-semibold transition",
              landingKey === null ? "bg-brand-tile text-white shadow-sm" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
            )}
          >
            Automatic
          </button>
          {enabled.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => {
                touch();
                setLandingKey(r.key);
              }}
              aria-pressed={landingKey === r.key}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition",
                landingKey === r.key ? "bg-brand-tile text-white shadow-sm" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </section>

      {planned.length > 0 ? (
        <section className="mt-5">
          <p className="px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Not built yet
          </p>
          <div className="mt-2 space-y-2">
            {planned.map((m) => {
              const Icon = ICONS[m.icon] ?? Grid3x3;
              return (
                <div
                  key={m.key}
                  className="flex items-start gap-3 rounded-2xl border border-dashed border-border/70 px-3.5 py-3 opacity-70"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground ring-1 ring-inset ring-border/60">
                    <Icon className="h-[17px] w-[17px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{m.label}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                      {m.blurb} <span className="opacity-80">Waiting on {m.needs}.</span>
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Sticky save — the list is long enough that a footer button would be
          below the fold on a phone the moment anything is reordered. */}
      <div className="sticky bottom-4 z-10 mt-5 flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy || !dirty} className="btn-lux btn-lux-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {dirty ? "Save sections" : "Saved"}
        </button>
        {msg ? (
          <p className={cn("text-sm font-medium", msg.ok ? "text-emerald-500" : "text-rose-500")}>{msg.text}</p>
        ) : null}
      </div>
    </div>
  );
}
