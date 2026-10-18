import Link from "next/link";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { StableAvatar } from "@/components/ui/stable-avatar";
import { cn } from "@/lib/utils";

/*
  The shared pieces of the Frenz screens (design/*.dc.html, 2026-10-18).
  Colours come only from the `frenz-*` tokens (lib/platform/design-tokens.ts);
  type from `font-heading` (Sora) and `font-body` (Hanken Grotesk), both scoped
  by `.frenz-ui` on each screen's root.
*/

/** The design's filled seal with a white tick. `size` is the px box. */
export function VerifiedBadge({ size = 15, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label="Verified"
      className={cn("shrink-0", className)}
    >
      <title>Verified</title>
      <path
        className="fill-frenz-blue"
        d="M12 2l2.4 1.8 3-.2.9 2.9 2.5 1.7-1 2.8 1 2.8-2.5 1.7-.9 2.9-3-.2L12 22l-2.4-1.8-3 .2-.9-2.9-2.5-1.7 1-2.8-1-2.8 2.5-1.7.9-2.9 3 .2z"
      />
      <path d="M8 12.2l2.6 2.6L16 9.4" fill="none" className="stroke-frenz-card" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A round avatar: the photo through StableAvatar (decoded once, never pops on
 * remount), else the person's initial on the brand gradient. `ring` draws the
 * design's gradient ring with a gap in the page colour (`ringGap`, a bg class).
 */
export function Avatar({
  src,
  name,
  size = 40,
  ring = false,
  ringGap = "border-frenz-page",
  online = false,
  loading,
  className,
}: {
  src?: string | null;
  /** Used for the initial when there is no photo. */
  name?: string | null;
  size?: number;
  ring?: boolean;
  /** The border class that separates the ring from the photo — the page ground. */
  ringGap?: string;
  online?: boolean;
  loading?: "lazy" | "eager";
  className?: string;
}) {
  const initial = (name ?? "").replace(/^@/, "").trim().charAt(0).toUpperCase() || "?";
  const inner = ring ? size - 5 : size;
  const face = src ? (
    <StableAvatar
      src={src}
      width={inner}
      height={inner}
      loading={loading}
      className={cn("h-full w-full rounded-full object-cover", ring && "border-[2.5px]", ring && ringGap)}
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "flex h-full w-full items-center justify-center rounded-full bg-frenz-gradient font-heading font-bold text-frenz-card",
        ring && "border-[2.5px]",
        ring && ringGap,
      )}
      style={{ fontSize: Math.round(size * 0.36) }}
    >
      {initial}
    </span>
  );
  return (
    <span
      className={cn("relative inline-flex shrink-0 rounded-full", ring && "bg-frenz-gradient p-[2.5px]", className)}
      style={{ width: size, height: size }}
    >
      {face}
      {online ? (
        <span
          aria-label="Online"
          role="img"
          className="absolute bottom-px right-px h-[13px] w-[13px] rounded-full border-[2.5px] border-frenz-card bg-emerald-500"
        />
      ) : null}
    </span>
  );
}

type IconButtonTone = "surface" | "ghost" | "gradient" | "glass";

const TONE: Record<IconButtonTone, string> = {
  surface: "border border-frenz-line bg-frenz-card text-frenz-ink",
  ghost: "bg-transparent text-frenz-ink",
  // primary actions only (owner, 2026-10-18: new message, chat mic/send)
  gradient: "bg-frenz-gradient-x text-white shadow-frenz-card",
  glass: "border border-white/25 bg-frenz-ink/45 text-white",
};

/** The number on an icon button (unread, new). 99+ past two digits. */
export function CountBadge({ count, gap = "border-frenz-page", className }: { count: number; gap?: string; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -right-[3px] -top-[3px] flex h-[19px] min-w-[19px] items-center justify-center rounded-full border-2 bg-frenz-magenta px-1 text-[10px] font-extrabold leading-none text-white",
        gap,
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

const ICON_BUTTON = "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2 motion-reduce:transition-none";

type IconButtonOwn = { label: string; tone?: IconButtonTone; badge?: number; badgeGap?: string; children: ReactNode; className?: string };

/** A 44 px icon-only control. `label` is required — it is the accessible name. */
export function IconButton({
  label,
  tone = "surface",
  badge = 0,
  badgeGap,
  children,
  className,
  ...rest
}: IconButtonOwn & Omit<ComponentPropsWithoutRef<"button">, "children" | "className">) {
  return (
    <button type="button" aria-label={badge > 0 ? `${label}, ${badge} new` : label} className={cn(ICON_BUTTON, TONE[tone], className)} {...rest}>
      {children}
      <CountBadge count={badge} gap={badgeGap} />
    </button>
  );
}

/** The same control as a link. */
export function IconLink({
  label,
  tone = "surface",
  badge = 0,
  badgeGap,
  children,
  className,
  ...rest
}: IconButtonOwn & Omit<ComponentPropsWithoutRef<typeof Link>, "children" | "className">) {
  return (
    <Link aria-label={badge > 0 ? `${label}, ${badge} new` : label} className={cn(ICON_BUTTON, TONE[tone], className)} {...rest}>
      {children}
      <CountBadge count={badge} gap={badgeGap} />
    </Link>
  );
}

/** "Recent · See all" — a Sora 20 px section title with an optional link on the right. */
export function SectionHeader({
  title,
  href,
  linkLabel = "See all",
  id,
  className,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between px-5 pb-2 pt-[26px]", className)}>
      <h2 id={id} className="m-0 font-heading text-xl font-bold tracking-[-0.5px] text-frenz-ink">
        {title}
      </h2>
      {href ? (
        <Link href={href} className="text-sm font-bold text-frenz-blue no-underline hover:text-frenz-violet">
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * A white card on the white page: the #ECE9F7 hairline separates it, and at most
 * a very soft shadow (owner, 2026-10-18). Never a gradient. `as` keeps the
 * semantics right (a section, an article, a list).
 */
export function Card({
  as: Tag = "div",
  raised = false,
  className,
  children,
  ...rest
}: {
  as?: "div" | "section" | "article" | "ul" | "li" | "nav";
  /** The design's one lifted card (the paste box) — still a neutral shadow. */
  raised?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"div">, "children" | "className">) {
  return (
    <Tag
      className={cn("rounded-[22px] border border-frenz-line bg-frenz-card", raised ? "shadow-frenz-raised" : "shadow-frenz-card", className)}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Tag>
  );
}

/** The fill every input, search bar and segmented control sits on (#F1F0F6). */
export const FIELD = "bg-frenz-fill text-frenz-ink placeholder:text-frenz-muted";

/**
 * A text field on the light fill, with an optional leading icon and trailing
 * control. The label is visually hidden but real. 16 px text so iOS never zooms.
 */
export function Input({
  id,
  label,
  icon,
  trailing,
  className,
  inputClassName,
  ...rest
}: {
  id: string;
  label: string;
  icon?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  inputClassName?: string;
} & Omit<ComponentPropsWithoutRef<"input">, "id" | "className">) {
  return (
    <div
      className={cn(
        "flex h-12 items-center gap-2.5 rounded-2xl px-3.5 focus-within:ring-2 focus-within:ring-frenz-violet/40",
        FIELD,
        className,
      )}
    >
      {icon ? <span className="flex shrink-0 text-frenz-muted">{icon}</span> : null}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        className={cn("min-w-0 flex-1 bg-transparent font-body text-base text-frenz-ink outline-none placeholder:text-frenz-muted", inputClassName)}
        {...rest}
      />
      {trailing}
    </div>
  );
}

/**
 * The native-style segmented control: a light-fill track, the chosen segment a
 * white tile with a soft shadow. Radio semantics, so arrow keys move the choice.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
      className={cn("grid auto-cols-fr grid-flow-col gap-1 rounded-2xl p-1", FIELD, className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-11 rounded-xl px-2 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet",
              on ? "bg-frenz-card font-bold text-frenz-ink shadow-frenz-raised" : "font-semibold text-frenz-ink/80",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
