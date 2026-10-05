"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { AiButton, AiButtonLink } from "@/features/ai/design/ai-button";
import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE MEMBERS GATE — a guest may LOOK at Frenz AI, not use it
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-05, replacing the 2026-09-09 rule: "anonymous users should
 * only see the welcome page and description, when they click the explore it
 * show a pop up modal that says sign in or login to use frenz ai features."
 *
 * So `/ai` itself is open (middleware.ts exempts that one path) and every link
 * on it that leads INTO a tool carries `data-ai-members`. For a visitor with no
 * auth cookie, a tap on one opens this dialog instead of navigating; for a
 * member it is an ordinary link. Every tool route stays guarded by middleware
 * and every AI endpoint by `resolveAiSubject` — this dialog is a courtesy, not
 * the lock.
 *
 * ── Why one delegated listener ──────────────────────────────────────────────
 * The links live in server-rendered markup and in the carousel. Delegation
 * means none of them has to become client code to be gated, and there is one
 * listener for the page instead of one per link.
 *
 * ── Why `<dialog>` ──────────────────────────────────────────────────────────
 * `showModal()` gives focus trapping, Escape, an inert page behind it and the
 * top layer (so no `fixed`-inside-a-blurred-ancestor bug —
 * fixed-position-portal-law) for zero bytes of library.
 *
 * `hasAuthCookie()` is a cookie read, not a request: deciding costs nothing.
 */
export function AiMembersGate() {
  const ref = useRef<HTMLDialogElement>(null);
  const [next, setNext] = useState("/ai");

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const link = (e.target as Element | null)?.closest?.("a[data-ai-members]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (hasAuthCookie()) return;
      e.preventDefault();
      setNext(link.pathname || "/ai");
      ref.current?.showModal();
    };
    // Capture, so next/link's own handler never starts a navigation first.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const close = () => ref.current?.close();

  return (
    <dialog
      ref={ref}
      aria-labelledby="ai-gate-title"
      aria-describedby="ai-gate-body"
      className="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-[1.5rem] border border-black/[0.06] bg-card p-0 text-foreground shadow-[0_24px_60px_-24px_rgba(15,23,42,0.45)] backdrop:bg-black/50"
      // A tap on the backdrop is a tap on the <dialog> itself.
      onClick={(e) => e.target === e.currentTarget && close()}
    >
      <div className="relative p-6 text-center">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-[0.95rem] bg-[#131a4a]">
          <FrenzLogo size={24} alt="" />
        </span>
        <h2 id="ai-gate-title" className="mt-4 text-[19px] font-bold tracking-[-0.02em]">
          Sign in to use Frenz AI
        </h2>
        <p id="ai-gate-body" className="mt-1.5 text-[14px] leading-snug text-muted-foreground">
          Sign in or create a free account to make videos, voices and audio with Frenz AI.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <AiButtonLink href={`/login?next=${encodeURIComponent(next)}`} block size="lg">
            Sign in or create account
          </AiButtonLink>
          <AiButton variant="secondary" block onClick={close}>
            Not now
          </AiButton>
        </div>
      </div>
    </dialog>
  );
}
