"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { hasAuthCookie } from "@/lib/auth/has-auth-cookie";

/*
  The SAME component the signed-in app shell uses (owner, 2026-08-16: one nav, shared across all) — imported lazily so
  a guest never downloads it.
*/
const MobileNav = dynamic(() => import("@/features/app-shell/mobile-nav").then((m) => m.MobileNav), { ssr: false });

/**
 * The marketing pages' bottom nav — MEMBERS ONLY (owner, 2026-10-29, AdSense review).
 *
 * Home, Friends, History, Chats and the profile tab are signed-in surfaces (lib/auth/app-only-paths.ts), so a guest
 * gets no nav at all: not hidden with CSS, absent from the HTML. The static document renders nothing here; after
 * hydration a visitor carrying an auth cookie gets the nav (and its clearance spacer). A guest pays no JS for it and
 * the landing's first paint is unchanged.
 */
export function MobileAppNav() {
  const [member, setMember] = useState(false);
  useEffect(() => setMember(hasAuthCookie()), []);
  if (!member) return null;
  return (
    <>
      {/* a page's last content clears the floating pill: its height + gap (`--frenz-nav-clearance`) and a little air */}
      <div aria-hidden className="h-[calc(var(--frenz-nav-clearance)+0.75rem)] lg:hidden" />
      <MobileNav marketing />
    </>
  );
}
