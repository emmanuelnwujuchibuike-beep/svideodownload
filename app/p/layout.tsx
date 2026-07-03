import type { ReactNode } from "react";

import { MobileNav } from "@/features/app-shell/mobile-nav";
import { StoryStudio } from "@/features/create/studio/story-studio";
import { UploadModal } from "@/features/create/upload-modal";

/**
 * Post pages live outside the (app) shell (public/SEO surface), but on mobile
 * the bottom nav must never disappear — navigation stays connected. The create
 * surfaces are mounted here too so the bottom-nav "+" opens the composer.
 */
export default function PostSectionLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <MobileNav />
      <UploadModal />
      <StoryStudio />
    </>
  );
}
