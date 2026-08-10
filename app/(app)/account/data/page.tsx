import type { Metadata } from "next";

import { DataControls } from "@/features/account/data-controls";
import { DataTransparency } from "@/features/account/data-transparency";
import { SettingsPage } from "@/features/account/settings-page";

export const metadata: Metadata = {
  title: "Your data",
  robots: { index: false, follow: false },
};

/**
 * Digital Ownership Center™ (Feature 18 · Part 24).
 *
 * ── Static, and that is the point ────────────────────────────────────────────
 * Everything on this page except the download button answers "what does Frenz
 * store, and why" — which is a property of the SCHEMA, not of one account. So
 * it renders from the portability registry with no query and no loading state,
 * and it is just as correct for somebody deciding whether to sign up as it is
 * for a member.
 *
 * `DataControls` (the existing download / delete island) stays a client
 * component and keeps doing exactly what it did.
 */
export default function DataPage() {
  return (
    <SettingsPage
      title="Your data"
      description="What we store, why we store it, how long we keep it — and how to take it with you or delete it."
      bare
    >
      <div className="space-y-8">
        <DataControls />
        <DataTransparency />
      </div>
    </SettingsPage>
  );
}
