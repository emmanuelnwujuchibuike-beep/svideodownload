"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { Spinner } from "@/features/wallet/tap-pending";
import { cn } from "@/lib/utils";

/*
  Every Friends button answers the tap (owner 2026-10-11, restated in the Friends brief 2026-10-26):
  pressed = scale 0.97; while its work runs, a spinner sits where the icon/label was, the button is
  disabled, and its WIDTH never changes — the label stays in the layout, only made invisible, with the
  spinner laid over it. One component for buttons, one for links, both on the shared <Spinner>.
*/

const PRESS = "relative transition-transform duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

function Busy({ pending, children, size, inner }: { pending: boolean; children: ReactNode; size: number; inner?: string }) {
  return (
    <>
      <span className={cn(inner ?? "inline-flex items-center justify-center gap-[inherit]", pending && "invisible")}>{children}</span>
      {pending ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size={size} />
          <span className="sr-only">Working…</span>
        </span>
      ) : null}
    </>
  );
}

export function PendingButton({
  pending = false,
  spinnerSize = 18,
  className,
  children,
  disabled,
  type = "button",
  inner,
  ...rest
}: ComponentProps<"button"> & { pending?: boolean; spinnerSize?: number; inner?: string }) {
  return (
    <button type={type} {...rest} disabled={disabled || pending} aria-busy={pending || undefined} className={cn(PRESS, className)}>
      <Busy pending={pending} size={spinnerSize} inner={inner}>
        {children}
      </Busy>
    </button>
  );
}

function LinkBody({ children, size, inner }: { children: ReactNode; size: number; inner?: string }) {
  const { pending } = useLinkStatus();
  return (
    <Busy pending={pending} size={size} inner={inner}>
      {children}
    </Busy>
  );
}

/** A <Link> that spins from the tap until the next screen opens (next/link useLinkStatus).
 *  `inner` replaces the wrapper's layout classes — a full-width row passes its own flex row here. */
export function PendingLink({ className, children, spinnerSize = 18, inner, ...rest }: ComponentProps<typeof Link> & { spinnerSize?: number; inner?: string }) {
  return (
    <Link {...rest} className={cn(PRESS, className)}>
      <LinkBody size={spinnerSize} inner={inner}>{children}</LinkBody>
    </Link>
  );
}
