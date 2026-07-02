import type { ReactNode } from "react";

import { MobileNav } from "@/features/app-shell/mobile-nav";

/**
 * Post pages live outside the (app) shell (public/SEO surface), but on mobile
 * the bottom nav must never disappear — navigation stays connected.
 */
export default function PostSectionLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <MobileNav />
    </>
  );
}
