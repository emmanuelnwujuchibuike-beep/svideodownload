"use client";

import { Activity, Heart, ImageIcon, UserPlus, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ModuleIconBadge } from "@/components/icons/module-icon-badge";
import { Switch } from "@/components/ui/switch";
import { timeAgo } from "@/features/notifications/meta";
import type { FriendActivityEntry } from "@/lib/social/friend-activity";

const ICONS: Record<FriendActivityEntry["kind"], typeof Heart> = {
  post: ImageIcon,
  story: Activity,
  like: Heart,
  follow: UserPlus,
};

/**
 * Home's "Friend Activity" module — relationship-first, real data (see
 * `getFriendActivity`), never a guessed engagement metric. Collapses to
 * nothing when a viewer has no friends or no recent activity AND hasn't
 * explicitly hidden it — no fake placeholder rows, matching
 * `ContinueWatching`'s own empty-state contract. Carries the same inline
 * on/off switch as Continue Watching (owner ask) — see that file's doc
 * comment for why it PATCHes `hideModule`/`showModule` instead of a full
 * `hiddenModules` array, and for why `initialHidden` (not a hardcoded
 * `true`) plus a post-toggle `router.refresh()` fix the "switch resets when
 * I leave and come back" bug (two separate causes — see that file).
 */
export function FriendActivity({ items, initialHidden = false }: { items: FriendActivityEntry[]; initialHidden?: boolean }) {
  const [on, setOn] = useState(!initialHidden);
  const router = useRouter();
  // Only auto-collapse for genuine emptiness while the module is actually
  // "on" — if the viewer explicitly hid it, the header+switch must still
  // render (regardless of whether there'd be activity to show) so it can be
  // turned back on from Home itself.
  if (on && items.length === 0) return null;

  const toggle = () => {
    const next = !on;
    setOn(next);
    fetch("/api/home-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next ? { showModule: "friend_activity" } : { hideModule: "friend_activity" }),
    })
      .then(() => router.refresh())
      .catch(() => {});
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
          <ModuleIconBadge icon={Activity} /> Friend Activity
        </h2>
        <Switch checked={on} onChange={toggle} label="Show Friend Activity on Home" />
      </div>
      {on ? (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <FriendActivityRow key={`${item.kind}-${item.actor.id}-${item.postId ?? item.target?.id ?? i}`} item={item} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function FriendActivityRow({ item }: { item: FriendActivityEntry }) {
  const Icon = item.kind === "post" && item.mediaKind === "video" ? Video : ICONS[item.kind];
  const href =
    item.kind === "story"
      ? `/u/${item.actor.handle}`
      : item.kind === "follow"
        ? `/u/${item.target?.handle}`
        : `/p/${item.postId}`;

  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-3.5 py-2.5 transition hover:bg-card"
      >
        <Avatar url={item.actor.avatarUrl} name={item.actor.displayName} />
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Icon className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <strong className="font-semibold">{item.actor.displayName}</strong>{" "}
          <span className="text-muted-foreground">{copyFor(item)}</span>
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
      </Link>
    </li>
  );
}

function copyFor(item: FriendActivityEntry): string {
  switch (item.kind) {
    case "post":
      return `posted${item.mediaKind === "video" ? " a video" : ""}${item.postTitle ? ` · ${item.postTitle}` : ""}`;
    case "story":
      return "added a story";
    case "like":
      return `liked your post${item.postTitle ? ` · ${item.postTitle}` : ""}`;
    case "follow":
      return `started following ${item.target?.displayName ?? "someone new"}`;
  }
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border" />;
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}
