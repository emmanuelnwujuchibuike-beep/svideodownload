"use client";

import { ArrowLeft, Globe, Images, Loader2, Lock, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { ProfileMediaGrid } from "@/features/social/profile-media-grid";
import { toast } from "@/features/ui/toast";
import type { PostCard } from "@/lib/social/posts";

type Vis = "public" | "followers" | "private";
interface CollectionCard {
  id: string;
  name: string;
  visibility: Vis;
  count: number;
  coverUrl: string | null;
  isOwner: boolean;
}

const VIS_ICON: Record<Vis, typeof Lock> = { private: Lock, followers: Users, public: Globe };

/**
 * The profile Collections tab. Fetches the profile's viewable collections on
 * mount (client-side, like Downloads), then drills into a collection's posts
 * in-place — no navigation. Each collection honours its own visibility, so this
 * only ever shows what the viewer is allowed to see.
 */
export function CollectionsTab({ ownerId, isOwner, emptyText }: { ownerId: string; isOwner: boolean; emptyText: string }) {
  const [loading, setLoading] = useState(true);
  const [collections, setCollections] = useState<CollectionCard[]>([]);
  const [open, setOpen] = useState<CollectionCard | null>(null);
  const [posts, setPosts] = useState<PostCard[] | null>(null);
  const [loadingPosts, setLoadingPosts] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/collections?user=${ownerId}`)
      .then((r) => (r.ok ? r.json() : { collections: [] }))
      .then((d) => alive && setCollections((d.collections ?? []) as CollectionCard[]))
      .catch(() => alive && setCollections([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [ownerId]);

  const openCollection = async (c: CollectionCard) => {
    setOpen(c);
    setPosts(null);
    setLoadingPosts(true);
    try {
      const r = await fetch(`/api/collections/${c.id}`);
      const d = await r.json();
      setPosts((d.posts ?? []) as PostCard[]);
    } catch {
      setPosts([]);
    } finally {
      setLoadingPosts(false);
    }
  };

  const remove = async (c: CollectionCard) => {
    if (!window.confirm(`Delete “${c.name}”? This can't be undone.`)) return;
    try {
      const r = await fetch(`/api/collections/${c.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error();
      setCollections((cs) => cs.filter((x) => x.id !== c.id));
      setOpen(null);
      toast("Collection deleted.", "success");
    } catch {
      toast("Couldn't delete the collection.", "error");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-14 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  // Drill-in: a single collection's posts.
  if (open) {
    const V = VIS_ICON[open.visibility];
    return (
      <div>
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen(null)}
            aria-label="Back to collections"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary/70 text-foreground transition hover:bg-secondary"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold">{open.name}</h3>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <V className="h-3.5 w-3.5" /> {open.count} {open.count === 1 ? "post" : "posts"}
            </p>
          </div>
          {open.isOwner ? (
            <button
              type="button"
              onClick={() => remove(open)}
              aria-label="Delete collection"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-500"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          ) : null}
        </div>
        {loadingPosts ? (
          <div className="flex items-center justify-center py-14 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <ProfileMediaGrid posts={posts ?? []} view="grid" emptyText="This collection is empty." />
        )}
      </div>
    );
  }

  if (collections.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-border/70 bg-card/40 p-12 text-center">
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
          <Images className="h-6 w-6" />
        </span>
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {collections.map((c) => {
        const V = VIS_ICON[c.visibility];
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => openCollection(c)}
            className="group overflow-hidden rounded-2xl border border-border/60 bg-card/60 text-left transition hover:border-foreground/15 hover:shadow-soft active:scale-[0.99]"
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-secondary">
              {c.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.coverUrl} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <Images className="h-7 w-7" />
                </span>
              )}
              {(isOwner || c.visibility !== "public") ? (
                <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                  <V className="h-3 w-3" />
                </span>
              ) : null}
            </div>
            <div className="p-2.5">
              <p className="truncate text-sm font-semibold">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c.count} {c.count === 1 ? "post" : "posts"}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
