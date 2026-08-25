"use client";

import { Dna, Eye, EyeOff, Globe2, Loader2, PauseCircle, RotateCcw, ShieldAlert, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useState } from "react";

import { LANGUAGES } from "@/lib/i18n/languages";
import { categoryLabel, type Category } from "@/lib/social/categories";
import type { InterestWeight } from "@/lib/social/frenz-dna";
import type { HomePreferences } from "@/lib/social/home-preferences";
import { cn } from "@/lib/utils";

/**
 * Discovery Controls + FrenzDNA™ (Feature 15 Part 8) — the viewer's own real
 * interest profile, and the honest levers over it: boost/hide a topic (the
 * SAME boosted/muted-category mechanism the "why am I seeing this" sheet and
 * HomeModulesEditor already use — this page just reviews it in one place),
 * Sensitive Content, content languages, Pause personalization, and Reset.
 */
export function DiscoveryControls({
  preferences,
  interests,
}: {
  preferences: HomePreferences;
  interests: InterestWeight[];
}) {
  const [boosted, setBoosted] = useState<Category[]>(preferences.boostedCategories);
  const [muted, setMuted] = useState<Category[]>(preferences.mutedCategories);
  const [paused, setPaused] = useState(preferences.personalizationPaused);
  const [sensitive, setSensitive] = useState(preferences.sensitiveContent);
  const [languages, setLanguages] = useState<string[]>(preferences.preferredLanguages);
  const [busy, setBusy] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/home-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
  };

  /** A topic is in exactly one state: boosted, muted, or neutral (in
   *  neither list). Setting it recomputes BOTH arrays from the category's
   *  target state, so a category can never end up in both lists at once. */
  const setTopicState = async (category: Category, state: "boosted" | "muted" | "neutral") => {
    setBusy(category);
    const prevBoosted = boosted;
    const prevMuted = muted;
    const nextBoosted = boosted.filter((c) => c !== category);
    const nextMuted = muted.filter((c) => c !== category);
    if (state === "boosted") nextBoosted.push(category);
    if (state === "muted") nextMuted.push(category);
    setBoosted(nextBoosted);
    setMuted(nextMuted);
    try {
      await patch({ boostedCategories: nextBoosted, mutedCategories: nextMuted });
    } catch {
      setBoosted(prevBoosted);
      setMuted(prevMuted);
    } finally {
      setBusy(null);
    }
  };

  const togglePaused = async () => {
    const next = !paused;
    setPaused(next);
    try {
      await patch({ personalizationPaused: next });
    } catch {
      setPaused(!next);
    }
  };

  const toggleSensitive = async () => {
    const next = !sensitive;
    setSensitive(next);
    try {
      await patch({ sensitiveContent: next });
    } catch {
      setSensitive(!next);
    }
  };

  const toggleLanguage = async (code: string) => {
    const next = languages.includes(code) ? languages.filter((l) => l !== code) : [...languages, code];
    const prev = languages;
    setLanguages(next);
    try {
      await patch({ preferredLanguages: next });
    } catch {
      setLanguages(prev);
    }
  };

  const reset = async () => {
    setResetting(true);
    setMsg(null);
    try {
      await Promise.all([
        patch({ boostedCategories: [], mutedCategories: [], personalizationPaused: false }),
        fetch("/api/frenz-dna", { method: "DELETE" }),
      ]);
      setBoosted([]);
      setMuted([]);
      setPaused(false);
      setMsg("Personalization reset. Your feed starts learning fresh.");
    } catch {
      setMsg("Couldn't reset — try again.");
    } finally {
      setResetting(false);
    }
  };

  const maxWeight = Math.max(1, ...interests.map((i) => i.weight));

  return (
    <div className="space-y-5">
      {/* FrenzDNA™ */}
      <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
        <div className="mb-1 flex items-center gap-2">
          <Dna className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Your Frenz DNA</h2>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          A private profile of what you actually engage with — never shared, never based on anyone else&apos;s
          activity. Boost a topic to see more, hide one to see less.
        </p>
        {interests.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
            Like, save or watch a few posts and your interests will show up here.
          </p>
        ) : (
          <div className="space-y-2.5">
            {interests.map((i) => {
              const isBoosted = boosted.includes(i.category);
              const isMuted = muted.includes(i.category);
              return (
                <div key={i.category} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 truncate text-xs font-medium">{categoryLabel(i.category)}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400"
                      style={{ width: `${Math.max(4, (i.weight / maxWeight) * 100)}%` }}
                    />
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={busy === i.category}
                      onClick={() => void setTopicState(i.category, isBoosted ? "neutral" : "boosted")}
                      aria-pressed={isBoosted}
                      aria-label={`Boost ${categoryLabel(i.category)}`}
                      className={cn(
                        "rounded-lg p-1.5 transition",
                        isBoosted ? "bg-emerald-500/15 text-emerald-500" : "text-muted-foreground hover:bg-secondary",
                      )}
                    >
                      <ThumbsUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy === i.category}
                      onClick={() => void setTopicState(i.category, isMuted ? "neutral" : "muted")}
                      aria-pressed={isMuted}
                      aria-label={`Hide ${categoryLabel(i.category)}`}
                      className={cn(
                        "rounded-lg p-1.5 transition",
                        isMuted ? "bg-rose-500/15 text-rose-500" : "text-muted-foreground hover:bg-secondary",
                      )}
                    >
                      <ThumbsDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Favorite / hidden topics review */}
      {boosted.length > 0 || muted.length > 0 ? (
        <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
          <h2 className="mb-3 text-sm font-semibold">Topics</h2>
          {boosted.length > 0 ? (
            <ChipRow icon={ThumbsUp} label="Favorite topics" items={boosted} onRemove={(c) => void setTopicState(c, "neutral")} />
          ) : null}
          {muted.length > 0 ? (
            <ChipRow icon={ThumbsDown} label="Hidden topics" items={muted} onRemove={(c) => void setTopicState(c, "neutral")} className="mt-3" />
          ) : null}
        </div>
      ) : null}

      {/* Content controls */}
      <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
        <h2 className="mb-3 text-sm font-semibold">Content</h2>
        <div className="space-y-2.5">
          <ToggleRow
            icon={ShieldAlert}
            title="Sensitive content"
            desc="Include mature-flagged posts in your feeds and Explore (off by default)"
            on={sensitive}
            onToggle={() => void toggleSensitive()}
          />
          <ToggleRow
            icon={PauseCircle}
            title="Pause personalization"
            desc="For You shows a plain, unranked recent feed until you turn this back off"
            on={paused}
            onToggle={() => void togglePaused()}
          />
        </div>
        <div className="mt-4">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Globe2 className="h-3.5 w-3.5" /> Content languages
          </p>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Saved for when language filtering ships — posts aren&apos;t tagged with a language yet, so this doesn&apos;t
            filter your feed today.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {LANGUAGES.slice(0, 16).map((l) => {
              const active = languages.includes(l.code);
              return (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => void toggleLanguage(l.code)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition",
                    active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-secondary/70",
                  )}
                >
                  {l.native}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Reset */}
      <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
        <h2 className="mb-1 text-sm font-semibold">Recommendation reset</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Clears your Frenz DNA, favorite/hidden topics and un-pauses personalization. Your follows, friends and posts
          are untouched.
        </p>
        <button
          type="button"
          onClick={() => void reset()}
          disabled={resetting}
          className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-secondary disabled:opacity-60"
        >
          {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reset personalization
        </button>
        {msg ? <p className="mt-2 text-xs text-muted-foreground">{msg}</p> : null}
      </div>
    </div>
  );
}

function ChipRow({
  icon: Icon,
  label,
  items,
  onRemove,
  className,
}: {
  icon: typeof Eye;
  label: string;
  items: Category[];
  onRemove: (c: Category) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onRemove(c)}
            aria-label={`Remove ${categoryLabel(c)}`}
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-secondary/70"
          >
            {categoryLabel(c)} <X className="h-3 w-3 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  title,
  desc,
  on,
  onToggle,
}: {
  icon: typeof Eye;
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
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted-foreground">{desc}</span>
        </span>
      </span>
      <span className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors", on ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border")}>
        <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform", on ? "translate-x-6" : "translate-x-1")} />
      </span>
    </button>
  );
}
