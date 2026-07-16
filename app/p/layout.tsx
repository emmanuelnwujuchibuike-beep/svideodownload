import type { ReactNode } from "react";

import { MobileNav } from "@/features/app-shell/mobile-nav";
import { StoryStudio } from "@/features/create/studio/story-studio";

/**
 * Post pages live outside the (app) shell (public/SEO surface), but on mobile
 * the bottom nav must never disappear — navigation stays connected. The nav's
 * "+" sheet now navigates to the dedicated /create routes rather than opening a
 * modal here, so only the Story Studio still needs mounting (it's the one
 * create surface that's still an overlay).
 */
export default function PostSectionLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <MobileNav />
      <StoryStudio />
    </>
  );
}
