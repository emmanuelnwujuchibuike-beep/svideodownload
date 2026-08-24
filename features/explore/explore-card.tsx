"use client";

import { Eye, ImageOff, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { MoreShareButton } from "@/features/media/more-share-button";
import { categoryLabel } from "@/lib/social/categories";
import type { PostCard } from "@/lib/social/posts";
import { postHref } from "@/lib/social/post-url";
import { cn, formatCompactNumber } from "@/lib/utils";

/**
 * A discovery tile: the image IS the card.
 *
 * Owner reference (`public/explore page.jpg`): a tall two-column grid where the
 * artwork fills the tile, the title sits over its lower third on a gradient,
 * a category badge floats top-left and a glass view-count pill bottom-right.
 * The previous card was a short thumbnail with text in a white box underneath,
 * which is what made the page read as a list rather than a discovery feed.
 *
 * ── 🔴 EVERY EFFECT HERE IS FREE ─────────────────────────────────────────
 * The gradient is a CSS `linear-gradient` painted once — not a blur, not a
 * filter, not a second stacked image. The press response is `transform` on the
 * card and `transform` on the image, both compositor-only. The one
 * `backdrop-blur` is on the view pill: a ~48×22px element, which is the size
 * the effect is affordable at. There is no blur anywhere near a full-bleed
 * surface, and nothing animates on scroll.
 *
 * ── 🔴 ASPECT RATIO, NOT A PIXEL HEIGHT ──────────────────────────────────
 * `aspect-[5/8]` gives ~240–330px across the phone range the brief names,
 * scales with the column instead of fighting it, and — because the ratio is
 * declared before the bytes arrive — reserves the tile's exact space. That is
 * what keeps CLS at zero while a screenful of images streams in.
 */
export function ExploreCard({
  post,
  featured = false,
  priority = false,
}: {
  post: PostCard;
  /** Spans both columns at 2:1 — the occasional editorial break in the grid. */
  featured?: boolean;
  /** Only the first row. Everything else stays lazy. */
  priority?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const cover = post.thumbnailUrl;
  const href = postHref(post);

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-[20px] bg-secondary",
        // A hairline rather than a shadow stack: the artwork supplies the depth,
        // and a drop shadow under every tile in a dense grid reads as noise.
        "ring-1 ring-inset ring-black/[0.06] dark:ring-white/[0.08]",
        "transition-transform duration-200 ease-[var(--ease-out)] active:scale-[0.98]",
        "motion-reduce:transition-none motion-reduce:active:scale-100",
        featured ? "col-span-2 aspect-[2/1]" : "aspect-[5/8]",
      )}
    >
      {cover && !broken ? (
        <Image
          src={cover}
          alt=""
          fill
          /*
            Two columns on a phone, so a tile is roughly half the viewport.
            Telling the optimizer that is what stops it shipping a 1080px-wide
            image into a 185px box.
          */
          sizes={featured ? "(max-width: 640px) 100vw, 640px" : "(max-width: 640px) 50vw, 320px"}
          loading={priority ? undefined : "lazy"}
          priority={priority}
          onError={() => setBroken(true)}
          className="object-cover transition-transform duration-300 ease-[var(--ease-out)] group-active:scale-[1.03] motion-reduce:transition-none motion-reduce:group-active:scale-100"
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-secondary to-muted text-muted-foreground"
        >
          {post.mediaKind === "video" ? <Play className="h-8 w-8" /> : <ImageOff className="h-8 w-8" />}
        </span>
      )}

      {/*
        The readability gradient. Bottom-weighted and stopping around 55%, so
        the top half of the artwork is untouched — the brief's "readable without
        making the image look dark".
      */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-black/85 via-black/45 to-transparent"
      />

      {post.category ? (
        <span className="absolute left-2.5 top-2.5 rounded-full bg-primary px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-[0.03em] text-primary-foreground shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)]">
          {categoryLabel(post.category)}
        </span>
      ) : null}

      {/* Sits ABOVE the card link so a share tap never opens the post. */}
      <span className="absolute right-1 top-1 z-20 text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
        <MoreShareButton href={href} title={post.title} />
      </span>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end gap-2 p-3">
        <h3
          className={cn(
            "min-w-0 flex-1 font-semibold text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.5)]",
            featured ? "text-[17px] leading-[1.25]" : "text-[14.5px] leading-[1.3]",
          )}
          // Clamped rather than truncated to one line: a two-line title is the
          // difference between a headline and a label.
          style={{ display: "-webkit-box", WebkitLineClamp: featured ? 2 : 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {post.title}
        </h3>

        <span className="flex shrink-0 items-center gap-1 self-end rounded-full bg-black/45 px-2 py-[3px] text-[11px] font-semibold text-white supports-[backdrop-filter]:backdrop-blur-[6px] supports-[backdrop-filter]:bg-black/30">
          <Eye className="h-3 w-3" aria-hidden />
          <span aria-hidden>{formatCompactNumber(post.viewsCount)}</span>
          <span className="sr-only">{post.viewsCount} views</span>
        </span>
      </div>

      {/*
        One link covering the tile, under the controls. A stretched link keeps
        the whole card tappable while leaving the title as real, selectable,
        screen-reader-visible text rather than an `aria-label` on a box.
      */}
      <Link href={href} prefetch className="absolute inset-0 z-[15]" aria-label={post.title}>
        <span className="sr-only">{post.title}</span>
      </Link>
    </article>
  );
}

/** Matches the tile exactly, so the grid never reflows when content lands. */
export function ExploreCardSkeleton({ featured = false }: { featured?: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        "overflow-hidden rounded-[20px] bg-secondary/70 shimmer",
        featured ? "col-span-2 aspect-[2/1]" : "aspect-[5/8]",
      )}
    >
      <div className="flex h-full flex-col justify-end gap-2 p-3">
        <div className="h-3 w-4/5 rounded bg-foreground/[0.06]" />
        <div className="h-3 w-3/5 rounded bg-foreground/[0.06]" />
      </div>
    </div>
  );
}
