"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import type { RelationshipPrivacy } from "@/lib/social/graph/store";
import { cn } from "@/lib/utils";

/**
 * Relationship privacy — three independent controls (Part 17).
 *
 * Independent is the point: the brief asks for friend lists, followers,
 * following and mutuals to be configurable separately, and they genuinely are
 * separate exposures. Bundling them into one "who can see my connections"
 * switch would force a member who is happy to show their follower count to
 * also publish the map of who they actually know.
 *
 * Saves immediately per control rather than behind a Save button — each one is
 * a single independent value, and a privacy setting that appears changed but
 * has not been submitted is the worst possible state for this screen to be in.
 */

const FRIEND_OPTIONS = [
  { value: "public", label: "Everyone", blurb: "Anyone can browse who you're friends with." },
  { value: "friends", label: "Friends", blurb: "Only people you're friends with." },
  { value: "private", label: "Only me", blurb: "Nobody else can see your friend list." },
] as const;

const FOLLOWING_OPTIONS = [
  { value: "public", label: "Everyone", blurb: "Anyone can see who you follow." },
  { value: "followers", label: "Followers", blurb: "Only accounts that follow you." },
  { value: "private", label: "Only me", blurb: "Nobody else can see who you follow." },
] as const;

export function RelationshipPrivacyPanel({ initial }: { initial: RelationshipPrivacy }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Partial<Record<string, unknown>>, key: string, next: RelationshipPrivacy) => {
    const previous = value;
    setValue(next);
    setSaving(key);
    setError(null);
    try {
      const res = await fetch("/api/privacy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      // Revert — a privacy control must never show a state it did not save.
      setValue(previous);
      setError("Couldn't save that. Check your connection and try again.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-5">
      <Group
        title="Who can see your friends"
        blurb="Your friend list maps the people you actually know, so it starts closed."
        options={FRIEND_OPTIONS}
        value={value.friendsVisibility}
        busy={saving === "friends"}
        onChange={(v) =>
          void save({ friends_visibility: v }, "friends", {
            ...value,
            friendsVisibility: v as RelationshipPrivacy["friendsVisibility"],
          })
        }
      />

      <Group
        title="Who can see who you follow"
        blurb="Following is public interest, not a relationship."
        options={FOLLOWING_OPTIONS}
        value={value.followingVisibility}
        busy={saving === "following"}
        onChange={(v) =>
          void save({ following_visibility: v }, "following", {
            ...value,
            followingVisibility: v as RelationshipPrivacy["followingVisibility"],
          })
        }
      />

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card px-3.5 py-3 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Count me in &ldquo;friends in common&rdquo;</p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              When two people who both know you are suggested to each other, they may be told they have friends in
              common. You are never named — only counted. Turn this off to be left out of the count entirely.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={value.showMutualConnections}
            aria-label="Count me in friends in common"
            disabled={saving === "mutual"}
            onClick={() =>
              void save({ show_mutual_connections: !value.showMutualConnections }, "mutual", {
                ...value,
                showMutualConnections: !value.showMutualConnections,
              })
            }
            className={cn(
              "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60",
              value.showMutualConnections ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                value.showMutualConnections ? "left-[22px]" : "left-0.5",
              )}
            />
          </button>
        </div>
      </div>

      {error ? <p className="text-xs font-medium text-rose-500">{error}</p> : null}
    </div>
  );
}

function Group({
  title,
  blurb,
  options,
  value,
  busy,
  onChange,
}: {
  title: string;
  blurb: string;
  options: readonly { value: string; label: string; blurb: string }[];
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="px-0.5 text-sm font-bold">
        {title}
        {busy ? <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
      </legend>
      <p className="mt-0.5 px-0.5 text-xs text-muted-foreground">{blurb}</p>
      <div className="mt-2 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={busy}
            onClick={() => onChange(o.value)}
            className="flex w-full items-center gap-3 border-b border-border/60 px-3.5 py-2.5 text-left transition last:border-0 hover:bg-secondary/40 disabled:opacity-60"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{o.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{o.blurb}</span>
            </span>
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition",
                value === o.value ? "bg-primary text-white" : "bg-secondary ring-1 ring-inset ring-border",
              )}
            >
              {value === o.value ? <Check className="h-3 w-3" /> : null}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
