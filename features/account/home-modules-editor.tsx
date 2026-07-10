"use client";

import { Reorder, useDragControls } from "framer-motion";
import { Clock, Eye, EyeOff, Flame, GripVertical, Loader2, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, Users, VolumeX, X } from "lucide-react";
import { useState } from "react";

import { categoryLabel, type Category } from "@/lib/social/categories";
import {
  DEFAULT_HOME_PREFERENCES,
  HOME_MODULE_KEYS,
  HOME_MODULE_LABELS,
  type HomeModuleKey,
  type HomePreferences,
} from "@/lib/social/home-preferences";
import { cn } from "@/lib/utils";

const MODULE_ICON: Record<HomeModuleKey, typeof Clock> = {
  stories: Sparkles,
  friend_activity: Users,
  trending_reels: Flame,
  continue_watching: Clock,
};

/**
 * Home Module Editor (Feature 17 Part 13) — drag-to-reorder + hide/show for
 * the optional Home sections (Stories/Friend Activity/Trending Reels/
 * Continue Watching), plus the real feed-behavior toggles ("prioritize my
 * friends", "fewer reposts", Quiet Mode). The main feed itself is never in
 * this list — it's infinite and always renders last, "reordering" it isn't
 * meaningful. First real use of framer-motion's `Reorder` in this codebase
 * (already a dependency everywhere else, so no new package).
 */
export function HomeModulesEditor({ preferences }: { preferences: HomePreferences }) {
  const [order, setOrder] = useState<HomeModuleKey[]>(preferences.moduleOrder);
  const [hidden, setHidden] = useState<Set<HomeModuleKey>>(new Set(preferences.hiddenModules));
  const [preferFriends, setPreferFriends] = useState(preferences.preferFriends);
  const [fewerReposts, setFewerReposts] = useState(preferences.fewerReposts);
  const [quietMode, setQuietMode] = useState(preferences.quietMode);
  const [mutedCategories, setMutedCategories] = useState<Category[]>(preferences.mutedCategories);
  const [boostedCategories, setBoostedCategories] = useState<Category[]>(preferences.boostedCategories);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const toggleHidden = (key: HomeModuleKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const reset = () => {
    setOrder(DEFAULT_HOME_PREFERENCES.moduleOrder);
    setHidden(new Set());
    setPreferFriends(false);
    setFewerReposts(false);
    setQuietMode(false);
    setMutedCategories([]);
    setBoostedCategories([]);
    setMsg(null);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/home-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleOrder: order,
          hiddenModules: [...hidden],
          preferFriends,
          fewerReposts,
          quietMode,
          mutedCategories,
          boostedCategories,
        }),
      });
      setMsg(res.ok ? { ok: true, text: "Home preferences saved." } : { ok: false, text: "Couldn't save." });
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="home-preferences" className="scroll-mt-24 border-b border-border/60 p-6 sm:p-8">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Home &amp; feed</h2>
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        Reorder or hide Home sections, and tell your feed what you want more or less of. Syncs across every device.
      </p>

      <p className="mb-2 text-xs font-semibold text-muted-foreground">Home sections</p>
      <Reorder.Group axis="y" values={order} onReorder={setOrder} className="space-y-2">
        {order.map((key) => (
          <ModuleRow key={key} module={key} isHidden={hidden.has(key)} onToggle={() => toggleHidden(key)} />
        ))}
      </Reorder.Group>

      <div className="mt-5 space-y-2.5">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">Feed behavior</p>
        <ToggleRow
          icon={Users}
          title="Prioritize my friends"
          desc="Boost posts from people you're friends with in For You"
          on={preferFriends}
          onToggle={() => setPreferFriends((v) => !v)}
        />
        <ToggleRow
          icon={EyeOff}
          title="Show fewer reposts"
          desc="Stop surfacing reposts from people you follow at the top of your feed"
          on={fewerReposts}
          onToggle={() => setFewerReposts((v) => !v)}
        />
        <ToggleRow
          icon={VolumeX}
          title="Quiet Mode"
          desc="Fewer discovery cards and catch-up banners — a calmer feed"
          on={quietMode}
          onToggle={() => setQuietMode((v) => !v)}
        />
      </div>

      {/* Content preferences (Feature 17 Part 14's Trust Dashboard) — the same
          mute/boost-by-category choices made from a feed card's "why am I
          seeing this" sheet, reviewable and removable here in one place. */}
      {mutedCategories.length > 0 || boostedCategories.length > 0 ? (
        <div className="mt-5 space-y-2.5">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Content preferences</p>
          {boostedCategories.length > 0 ? (
            <ChipRow
              icon={ThumbsUp}
              label="Seeing more of"
              categories={boostedCategories}
              onRemove={(c) => setBoostedCategories((prev) => prev.filter((x) => x !== c))}
            />
          ) : null}
          {mutedCategories.length > 0 ? (
            <ChipRow
              icon={ThumbsDown}
              label="Hidden from For You"
              categories={mutedCategories}
              onRemove={(c) => setMutedCategories((prev) => prev.filter((x) => x !== c))}
            />
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
        </button>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-secondary"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset to default
        </button>
        {msg ? <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
      </div>
    </div>
  );
}

function ModuleRow({
  module,
  isHidden,
  onToggle,
}: {
  module: HomeModuleKey;
  isHidden: boolean;
  onToggle: () => void;
}) {
  const controls = useDragControls();
  const Icon = MODULE_ICON[module];
  return (
    <Reorder.Item
      value={module}
      dragListener={false}
      dragControls={controls}
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/15 p-3.5",
        isHidden && "opacity-50",
      )}
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        aria-label="Drag to reorder"
        className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium">{HOME_MODULE_LABELS[module]}</span>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={!isHidden}
        aria-label={isHidden ? `Show ${HOME_MODULE_LABELS[module]}` : `Hide ${HOME_MODULE_LABELS[module]}`}
        className="shrink-0 rounded-lg p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
      >
        {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </Reorder.Item>
  );
}

function ChipRow({
  icon: Icon,
  label,
  categories,
  onRemove,
}: {
  icon: typeof Clock;
  label: string;
  categories: Category[];
  onRemove: (c: Category) => void;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-secondary/15 p-3.5">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
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
  icon: typeof Clock;
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
      <span
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
          on ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
            on ? "translate-x-6" : "translate-x-1",
          )}
        />
      </span>
    </button>
  );
}
