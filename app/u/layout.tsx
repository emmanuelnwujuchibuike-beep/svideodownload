import type { ReactNode } from "react";

import { MobileNav } from "@/features/app-shell/mobile-nav";

/**
 * Profile pages live outside the (app) shell (public/SEO surface with the
 * marketing header), but on mobile the bottom nav must never disappear —
 * navigation stays connected across every page.
 */
export default function ProfileSectionLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <MobileNav />
    </>
  );
}
