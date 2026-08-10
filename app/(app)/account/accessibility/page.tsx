import type { Metadata } from "next";

import { AccessibilityCenter } from "@/features/account/accessibility-center";
import { SettingsPage } from "@/features/account/settings-page";

export const metadata: Metadata = {
  title: "Accessibility",
  robots: { index: false, follow: false },
};

/**
 * Accessibility Center™ (Feature 18 · Part 22).
 *
 * ── Why this route is not `force-dynamic` like its siblings ─────────────────
 * Every other settings page reads the member's server state. This one reads
 * `localStorage` and nothing else — accessibility preferences are device-local
 * by design (a phone may need 130% text while a laptop does not, and a
 * screen-reader setup should not follow you onto a shared tablet). So the page
 * is static and the client island inside it is the whole feature.
 *
 * That also means it works signed OUT and offline, which matters: someone who
 * cannot read the default type size should not have to sign in first.
 */
export default function AccessibilityPage() {
  return (
    <SettingsPage
      title="Accessibility"
      description="Text, contrast, motion and touch. Every change applies instantly."
      bare
    >
      <AccessibilityCenter />
    </SettingsPage>
  );
}
