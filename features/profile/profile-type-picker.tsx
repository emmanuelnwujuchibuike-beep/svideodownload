"use client";

import {
  Briefcase,
  Building2,
  Check,
  Code2,
  GraduationCap,
  Landmark,
  Loader2,
  Lock,
  School,
  Sparkles,
  Store,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SETTINGS_TINTS } from "@/features/account/settings-ui";
import { profileModule } from "@/lib/profile/modules";
import {
  futureProfileTypes,
  selectableProfileTypes,
  type ProfileTypeKey,
} from "@/lib/profile/profile-types";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  UserRound,
  Sparkles,
  Store,
  Briefcase,
  GraduationCap,
  Code2,
  Users,
  Building2,
  Landmark,
  School,
};

/**
 * Identity Switching™ — one profile, many purposes (Feature 18 · Part 14).
 *
 * The most important thing this screen does is TELL THE TRUTH about what
 * switching costs: nothing. No content moves, no followers reset, no second
 * account. It changes which sections are offered — and because the modules a
 * member has already customised are stored per module, switching away and back
 * restores exactly what they had. That is why each card previews the sections
 * it turns on rather than describing the type in the abstract.
 */
export function ProfileTypePicker({ current }: { current: ProfileTypeKey }) {
  const router = useRouter();
  const [value, setValue] = useState<ProfileTypeKey>(current);
  const [busy, setBusy] = useState<ProfileTypeKey | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const choose = async (key: ProfileTypeKey) => {
    if (key === value || busy) return;
    const previous = value;
    setValue(key); // optimistic — the cards are the feedback
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_type: key }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setValue(previous); // put the UI back — nothing was saved
        setMsg({ ok: false, text: json.error ?? "Couldn't switch profile type." });
        return;
      }
      setMsg({ ok: true, text: "Switched. Your sections have been updated." });
      router.refresh();
    } catch {
      setValue(previous);
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="space-y-2.5">
        {selectableProfileTypes().map((t) => {
          const Icon = ICONS[t.icon] ?? UserRound;
          const active = value === t.key;
          const sections = t.defaultModules
            .map((k) => profileModule(k)?.label)
            .filter(Boolean)
            .join(" · ");
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => void choose(t.key)}
              disabled={!!busy}
              aria-pressed={active}
              className={cn(
                "flex w-full items-start gap-3.5 rounded-2xl border p-3.5 text-left transition disabled:opacity-60",
                active
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border/70 hover:border-foreground/20 hover:bg-secondary/30",
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
                  SETTINGS_TINTS[t.tint] ?? SETTINGS_TINTS.slate,
                )}
              >
                <Icon className="h-[19px] w-[19px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{t.label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{t.tagline}</span>
                <span className="mt-1.5 block truncate text-[11px] font-medium text-muted-foreground/80">
                  Sections: {sections}
                </span>
              </span>
              {busy === t.key ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
              ) : active ? (
                <Check className="h-5 w-5 shrink-0 text-primary" />
              ) : null}
            </button>
          );
        })}
      </div>

      {msg ? (
        <p className={cn("mt-3 text-sm font-medium", msg.ok ? "text-emerald-500" : "text-rose-500")}>{msg.text}</p>
      ) : null}

      <p className="mt-4 rounded-2xl bg-secondary/40 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
        Switching is free and reversible. Your posts, followers, downloads and settings stay exactly where they are —
        only the sections your profile offers change, and anything you&apos;ve already written into a section is kept
        even while it&apos;s switched off.
      </p>

      {/* Declared for later. Rendered as plainly unavailable, with the reason —
          an affordance that looks tappable but does nothing is worse than none. */}
      <div className="mt-5">
        <p className="px-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Coming later</p>
        <div className="mt-2 space-y-2.5">
          {futureProfileTypes().map((t) => {
            const Icon = ICONS[t.icon] ?? UserRound;
            return (
              <div
                key={t.key}
                className="flex items-start gap-3.5 rounded-2xl border border-dashed border-border/70 p-3.5 opacity-70"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground ring-1 ring-inset ring-border/60">
                  <Icon className="h-[19px] w-[19px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{t.label}</span>
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Later
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{t.tagline}</span>
                </span>
                <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
