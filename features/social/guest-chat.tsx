"use client";

import { MessageCircle, Users, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";

/**
 * Chats for a SIGNED-OUT visitor (owner, 2026-10-16: "anonymous users only see the
 * chat page but without any private info, like no Profile avatar anywhere and empty
 * chat, and if they want to add Friends or start new chat they see a modal to sign in").
 *
 * The guest test is the auth cookie (no request). The server snapshot says "member",
 * so the server HTML never differs from a member's; hydration then switches a guest
 * over in the same frame.
 */
const noop = () => () => {};
export function useIsGuest(): boolean {
  return useSyncExternalStore(noop, () => !hasAuthCookie(), () => false);
}

const NEXT = `/login?next=${encodeURIComponent("/messages")}`;

/** The empty inbox a guest sees — nothing fetched, nothing private. */
export function GuestInbox() {
  return (
    <div className="flex flex-col items-center px-6 pt-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/15 to-violet-500/15">
        <MessageCircle className="h-6 w-6 text-violet-500" aria-hidden />
      </span>
      <p className="mt-3 text-[15px] font-semibold">No chats yet</p>
      <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">Sign in to add friends and start chatting.</p>
      <Link
        href={NEXT}
        prefetch={false}
        className="mt-4 inline-flex min-h-[2.75rem] items-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 px-6 text-[14px] font-semibold text-white transition active:scale-[0.98] motion-reduce:active:scale-100"
      >
        Sign in
      </Link>
    </div>
  );
}

/** The sign-in modal a guest gets from New chat, the tools menu and the locked Friends page. */
export function GuestSignInModal({
  open,
  onClose,
  next = "/messages",
  title = "Sign in to chat",
  body = "Add friends and start conversations with a free Frenz account.",
  icon: Icon = MessageCircle,
}: {
  open: boolean;
  onClose: () => void;
  next?: string;
  title?: string;
  body?: string;
  icon?: LucideIcon;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-3 sm:items-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-signin-title"
        className="relative w-full max-w-sm rounded-3xl bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-center shadow-elevated sm:pb-5"
      >
        <button type="button" aria-label="Close" onClick={onClose} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary">
          <X className="h-4 w-4" aria-hidden />
        </button>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/15 to-violet-500/15">
          <Icon className="h-5 w-5 text-violet-500" aria-hidden />
        </span>
        <p id="guest-signin-title" className="mt-3 text-[16px] font-bold">{title}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          prefetch={false}
          className="mt-4 flex min-h-[2.75rem] w-full items-center justify-center rounded-full bg-gradient-to-r from-blue-600 to-violet-600 text-[14px] font-semibold text-white transition active:scale-[0.98] motion-reduce:active:scale-100"
        >
          Sign in
        </Link>
        <button type="button" onClick={onClose} className="mt-2 min-h-[2.5rem] w-full text-[13px] font-medium text-muted-foreground">
          Not now
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The Friends page for a guest (owner, 2026-10-16: "the add friends button should open
 * the friends page but won't be able to interact or click on any, it will show sign in").
 * The page renders with empty data; every tap, key or focus inside is caught before it
 * reaches a control and opens the sign-in modal instead. The modal sits OUTSIDE the
 * locked box, so its own buttons work (React events bubble through portals).
 */
export function GuestLock({ children, next }: { children: React.ReactNode; next: string }) {
  const [ask, setAsk] = useState(false);
  const stop = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <>
      <div
        onClickCapture={(e) => {
          stop(e);
          setAsk(true);
        }}
        onPointerDownCapture={stop}
        onKeyDownCapture={(e) => {
          if (e.key === "Tab") return;
          stop(e);
          if (e.key === "Enter" || e.key === " ") setAsk(true);
        }}
        onFocusCapture={(e) => {
          if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) e.target.blur();
        }}
      >
        {children}
      </div>
      <GuestSignInModal open={ask} onClose={() => setAsk(false)} next={next} title="Sign in to see your friends" body="Add friends, see requests and chat with a free Frenz account." icon={Users} />
    </>
  );
}
