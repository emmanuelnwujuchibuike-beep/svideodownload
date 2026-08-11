"use client";

import { BarChart3, Search } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { audienceSpec, type RepostAudience } from "@/lib/social/repost/audience";
import { cn } from "@/lib/utils";

import { RepostGlyph } from "./repost-glyph";
import { RepostInsightsSheet } from "./repost-insights-sheet";
import { SocialRippleLoader } from "./social-ripple";

/**
 * The interactive half of the Repost Page (Feature 15 · Part 4).
 *
 * ── Tabs and search filter the SET THE SERVER ALREADY SENT ───────────────
 * All three tabs are subsets of one audience-filtered read, so switching costs
 * nothing and cannot return a row the gate would have excluded. Re-querying per
 * tab would mean three chances to forget the filter.
 *
 * ── Search covers the CAPTION, not just names ────────────────────────────
 * The recommendation someone wrote is the most useful thing on this page and is
 * the reason "searchable" was asked for at all.
 */

interface Entry {
  repostId: string;
  userId: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  caption: string | null;
  createdAt: string;
  audience: RepostAudience;
  isFriend: boolean;
  isFollowing: boolean;
  viaRepost: boolean;
}

type Tab = "all" | "friends" | "quotes";

export function RepostPageClient({
  postId,
  initial,
  isOwner,
}: {
  postId: string;
  initial: { entries: Entry[]; counts: { all: number; friends: number; quotes: number } };
  isOwner: boolean;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [insightsOpen, setInsightsOpen] = useState(false);

  const shown = useMemo(() => {
    let list = initial.entries;
    if (tab === "friends") list = list.filter((e) => e.isFriend || e.isFollowing);
    else if (tab === "quotes") list = list.filter((e) => !!e.caption);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.handle.toLowerCase().includes(q) ||
          (e.displayName ?? "").toLowerCase().includes(q) ||
          (e.caption ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [initial.entries, tab, query]);

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "Everyone", count: initial.counts.all },
    { key: "friends", label: "Your people", count: initial.counts.friends },
    { key: "quotes", label: "With a note", count: initial.counts.quotes },
  ];

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold transition",
                tab === t.key
                  ? "bg-[linear-gradient(100deg,#2563eb,#7c3aed)] text-white"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary",
              )}
            >
              {t.label}
              {t.count > 0 ? <span className="ml-1.5 tabular-nums opacity-80">{t.count}</span> : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setInsightsOpen(true)}
          aria-label="Repost insights"
          className="shrink-0 rounded-full bg-secondary/60 p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <BarChart3 className="h-4 w-4" strokeWidth={2.1} />
        </button>
      </div>

      <label className="mt-3 flex items-center gap-2 rounded-2xl bg-secondary/50 px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-primary">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.2} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people or what they said"
          aria-label="Search reposts"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>

      {/* Social Ripple™ — how it actually travelled. Above the list because it is
          the answer to "how far did this go", and the list is the detail. */}
      <section className="mt-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
          <RepostGlyph className="h-4 w-4 text-violet-500" strokeWidth={2.3} /> How it spread
        </h2>
        <SocialRippleLoader postId={postId} />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-bold">
          {shown.length === 0 ? "Reposters" : shown.length === 1 ? "1 reposter" : `${shown.length} reposters`}
        </h2>
        {shown.length === 0 ? (
          <p className="rounded-2xl bg-secondary/40 px-4 py-6 text-center text-sm text-muted-foreground">
            {query.trim()
              ? "Nothing matches that."
              : tab === "quotes"
                ? "Nobody has added a note yet."
                : tab === "friends"
                  ? "Nobody you follow has reposted this."
                  : "No reposts yet."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((e) => (
              <li key={e.repostId} className="rounded-2xl bg-secondary/40 p-3">
                <div className="flex items-center gap-2.5">
                  <Link href={`/u/${e.handle}`} className="shrink-0">
                    {e.avatarUrl ? (
                      <Image
                        src={e.avatarUrl}
                        alt=""
                        width={36}
                        height={36}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      <span className="block h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-violet-600" />
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/u/${e.handle}`} className="flex items-center gap-1 text-sm font-semibold hover:underline">
                      <span className="truncate">{e.displayName || `@${e.handle}`}</span>
                      {e.isVerified ? <VerifiedTick className="h-3.5 w-3.5 shrink-0" /> : null}
                    </Link>
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span>@{e.handle}</span>
                      {/* The audience badge appears only when it is NOT public —
                          and the only non-public rows that ever reach a viewer
                          are ones they were included in, or their own. */}
                      {e.audience !== "public" ? (
                        <span className="rounded-full bg-background px-1.5 py-px font-semibold">
                          {audienceSpec(e.audience).badge}
                        </span>
                      ) : null}
                      {e.viaRepost ? <span title="Found it through someone else's repost">· passed on</span> : null}
                    </p>
                  </div>
                </div>
                {e.caption ? (
                  <p className="mt-2 border-l-2 border-violet-500/40 pl-2.5 text-sm leading-snug text-foreground/90">
                    {e.caption}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOwner ? (
        <p className="mt-4 text-center text-[11px] leading-snug text-muted-foreground/80">
          You only ever see public reposts of your own post here. Private recommendations stay private.
        </p>
      ) : null}

      <RepostInsightsSheet postId={postId} open={insightsOpen} onClose={() => setInsightsOpen(false)} />
    </div>
  );
}
