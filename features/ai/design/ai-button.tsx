import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { TapOnceLink } from "@/features/ui/tap-once-link";
import { cn } from "@/lib/utils";

/**
 * THE AI BUTTON — one primary, one secondary, for every Frenz AI page
 * (redesign 2026-10-05, docs/FRENZ_AI_REDESIGN_BRIEFS.md Brief A "BUTTON SYSTEM").
 *
 *   primary   — Create with AI, Generate, Clone Voice, Download, Continue.
 *               Static brand gradient, moderate radius, no glass, minimal glow.
 *   secondary — Explore, Cancel, Back, View, Learn more. Quiet: a light
 *               surface and a hairline edge.
 *
 * The look is CSS (`.ai-btn*` in app/globals.css), so this file has no client
 * code and a server page can render it without shipping a byte of JS for it.
 * `href` makes it a `next/link`; otherwise it is a `<button>`.
 *
 * `iconEnd` is the trailing glyph that nudges 2 px on hover — the arrow.
 */

type Variant = "primary" | "secondary";
type Size = "sm" | "md" | "lg";

interface Common {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconEnd?: ReactNode;
  block?: boolean;
  className?: string;
  children: ReactNode;
}

export function aiButtonClass({
  variant = "primary",
  size = "md",
  block,
  className,
}: Pick<Common, "variant" | "size" | "block" | "className">) {
  return cn(
    "ai-btn",
    variant === "primary" ? "ai-btn--primary" : "ai-btn--secondary",
    size === "lg" && "ai-btn--lg",
    size === "sm" && "ai-btn--sm",
    block && "w-full",
    className,
  );
}

function Inner({ icon, iconEnd, children }: Pick<Common, "icon" | "iconEnd" | "children">) {
  return (
    <>
      {icon ? <span className="-ml-0.5 flex shrink-0" aria-hidden>{icon}</span> : null}
      <span className="truncate">{children}</span>
      {iconEnd ? <span className="ai-btn__icon-end -mr-0.5 flex shrink-0" aria-hidden>{iconEnd}</span> : null}
    </>
  );
}

export function AiButtonLink({
  variant,
  size,
  icon,
  iconEnd,
  block,
  className,
  children,
  tapOnce,
  ...rest
}: Common &
  Omit<ComponentProps<typeof Link>, "className" | "children"> & {
    /**
     * Respond on the FIRST tap (owner, 2026-10-08: "make the buttons in the promote
     * page respond instantly … show the button loading like the earn button"):
     * the button shows its pending state at once, warms the route on press, and
     * a second tap cannot fire while the next page is still on its way.
     */
    tapOnce?: boolean;
  }) {
  if (tapOnce && typeof rest.href === "string") {
    return (
      <TapOnceLink {...rest} href={rest.href} className={aiButtonClass({ variant, size, block, className: cn("data-[pending]:opacity-80", className) })}>
        <Inner icon={icon} iconEnd={iconEnd}>{children}</Inner>
      </TapOnceLink>
    );
  }
  return (
    <Link {...rest} className={aiButtonClass({ variant, size, block, className })}>
      <Inner icon={icon} iconEnd={iconEnd}>{children}</Inner>
    </Link>
  );
}

export function AiButton({
  variant,
  size,
  icon,
  iconEnd,
  block,
  className,
  children,
  type = "button",
  ...rest
}: Common & Omit<ComponentProps<"button">, "className" | "children">) {
  return (
    <button {...rest} type={type} className={aiButtonClass({ variant, size, block, className })}>
      <Inner icon={icon} iconEnd={iconEnd}>{children}</Inner>
    </button>
  );
}
