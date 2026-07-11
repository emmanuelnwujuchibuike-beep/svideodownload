"use client";

import { BadgeCheck, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Rich preview card for a post shared into a chat (the Share sheet sends the
 * /p/<id> link). Shows the original creator, cover and caption; tapping opens
 * the post. Privacy-safe: the preview endpoint 404s for viewers who can't see
 * the post, in which case we render a quiet "post unavailable" chip instead of
 * leaking anything. Previews are module-cached so long threads stay cheap.
 */

export interface SharedPostPreview {
  id: string;
  title: string;
  mediaKind: string;
  thumbnailUrl: string | null;
  createdAt: string;
  publisher: { handle: string; displayName: string; avatarUrl: string | null; isVerified: boolean };
}

const cache = new Map<string, SharedPostPreview | "unavailable">();
const inflight = new Map<string, Promise<SharedPostPreview | "unavailable">>();

function loadPreview(postId: string): Promise<SharedPostPreview | "unavailable"> {
  const hit = cache.get(postId);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(postId);
  if (pending) return pending;
  const p = (async () => {
    try {
      const res = await fetch(`/api/posts/${postId}`);
      if (!res.ok) return "unavailable" as const;
      const d = (await res.json()) as { post?: SharedPostPreview };
      return d.post ?? ("unavailable" as const);
    } catch {
      return "unavailable" as const;
    }
  })().then((v) => {
    cache.set(postId, v);
    inflight.delete(postId);
    return v;
  });
  inflight.set(postId, p);
  return p;
}

/** Matches a shared post link and returns [postId, textWithoutLink]. */
export function extractSharedPost(body: string): { postId: string; text: string } | null {
  const m = body.match(/https?:\/\/[^\s]+\/p\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i);
  if (!m) return null;
  return { postId: m[1]!, text: body.replace(m[0], "").trim() };
}

export function MessagePostEmbed({ postId, mine }: { postId: string; mine: boolean }) {
  const [preview, setPreview] = useState<SharedPostPreview | "unavailable" | null>(() => cache.get(postId) ?? null);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    void loadPreview(postId).then((v) => {
      if (!cancelled) setPreview(v);
    });
    return () => {
      cancelled = true;
    };
  }, [postId, preview]);

  if (preview === "unavailable") {
    return (
      <span className="block rounded-2xl border border-border/60 bg-secondary/50 px-3.5 py-2.5 text-xs text-muted-foreground">
        This post isn&apos;t available.
      </span>
    );
  }

  if (!preview) {
    return (
      <span className="block w-full max-w-60 overflow-hidden rounded-2xl border border-border/60" aria-hidden>
        <span className="block aspect-[4/3] w-full bg-secondary shimmer" />
        <span className="block space-y-1.5 p-2.5">
          <span className="block h-3 w-28 rounded bg-secondary shimmer" />
          <span className="block h-2.5 w-40 rounded bg-secondary shimmer" />
        </span>
      </span>
    );
  }

  return (
    <Link
      href={`/p/${preview.id}`}
      className={
        "block w-full max-w-60 overflow-hidden rounded-2xl border transition hover:opacity-95 active:scale-[0.99] " +
        (mine ? "border-white/25 bg-black/20" : "border-border/60 bg-card")
      }
    >
      {preview.thumbnailUrl ? (
        <span className="relative block aspect-[4/3] w-full overflow-hidden bg-neutral-950">
          <Image src={preview.thumbnailUrl} alt="" fill sizes="240px" className="object-cover" />
          {preview.mediaKind === "video" ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
                <Play className="ml-0.5 h-5 w-5 fill-white" />
              </span>
            </span>
          ) : null}
        </span>
      ) : null}
      <span className="block p-2.5">
        <span className="flex items-center gap-1.5">
          {preview.publisher.avatarUrl ? (
            <Image src={preview.publisher.avatarUrl} alt="" width={18} height={18} className="h-[18px] w-[18px] rounded-full object-cover" />
          ) : (
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-[9px] font-bold text-white">
              {preview.publisher.displayName.charAt(0).toUpperCase()}
            </span>
          )}
          <span className={"truncate text-xs font-semibold " + (mine ? "text-white" : "text-foreground")}>
            {preview.publisher.displayName}
          </span>
          {preview.publisher.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-400" /> : null}
        </span>
        {preview.title ? (
          <span className={"mt-1 line-clamp-2 block text-xs leading-snug " + (mine ? "text-white/85" : "text-muted-foreground")}>
            {preview.title}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
