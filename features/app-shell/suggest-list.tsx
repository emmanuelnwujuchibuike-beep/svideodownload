"use client";

import { BadgeCheck, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cn, formatCompactNumber } from "@/lib/utils";

export interface SuggestItem {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  isVerified: boolean;
  followersCount: number;
}

/** "People You May Know" — optimistic follow with rollback on failure. */
export function SuggestList({ items }: { items: SuggestItem[] }) {
  if (items.length === 0) {
    return <p className="px-1 py-2 text-xs text-muted-foreground">No suggestions right now.</p>;
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <SuggestRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

function SuggestRow({ item }: { item: SuggestItem }) {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    const next = !following;
    setFollowing(next); // optimistic
    setBusy(true);
    try {
      const res = await fetch(`/api/follow/${item.id}`, { method: next ? "POST" : "DELETE" });
      if (!res.ok) setFollowing(!next); // rollback
    } catch {
      setFollowing(!next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex items-center gap-2.5">
      <Link href={`/u/${item.handle}`} className="shrink-0">
        {item.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-border" />
        ) : (
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-xs font-bold text-white">
            {item.displayName.charAt(0).toUpperCase()}
          </span>
        )}
      </Link>
      <Link href={`/u/${item.handle}`} className="min-w-0 flex-1">
        <span className="flex items-center gap-1 text-sm font-semibold leading-tight">
          <span className="truncate">{item.displayName}</span>
          {item.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {formatCompactNumber(item.followersCount)} followers
        </span>
      </Link>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={following}
        className={cn(
          "inline-flex h-8 min-w-[60px] items-center justify-center gap-1 rounded-lg px-3 text-xs font-semibold transition disabled:opacity-70",
          following
            ? "bg-secondary text-foreground"
            : "bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:opacity-95",
        )}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : following ? <Check className="h-3.5 w-3.5" /> : null}
        {following ? "Following" : "Add"}
      </button>
    </li>
  );
}
