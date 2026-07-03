import type { ReactNode } from "react";

import { MobileNav } from "@/features/app-shell/mobile-nav";
import { StoryStudio } from "@/features/create/studio/story-studio";
import { UploadModal } from "@/features/create/upload-modal";

/**
 * Profile pages live outside the (app) shell (public/SEO surface with the
 * marketing header), but on mobile the bottom nav must never disappear —
 * navigation stays connected across every page. The create surfaces
 * (UploadModal + StoryStudio) are mounted here too, so the bottom-nav "+" button
 * actually opens the composer on profile pages (they only live in the (app)
 * layout otherwise, which doesn't wrap /u).
 */
export default function ProfileSectionLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <MobileNav />
      <UploadModal />
      <StoryStudio />
    </>
  );
}
