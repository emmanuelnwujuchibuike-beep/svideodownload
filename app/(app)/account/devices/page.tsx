import type { Metadata } from "next";

import { ConnectedDevices } from "@/features/account/connected-devices";
import { SettingsPage } from "@/features/account/settings-page";

export const metadata: Metadata = {
  title: "Connected devices",
  robots: { index: false, follow: false },
};

/**
 * Connected Devices Hub™ (Feature 18 · Part 23).
 *
 * Dynamic, unlike the Accessibility Center next door: this reads the member's
 * real session list, so there is nothing to prerender and a cached shell would
 * show someone another moment's devices.
 *
 * The list itself is fetched by the client island from `/api/v1/app/sessions` —
 * the same endpoint `/account/security` already uses. One endpoint, one merge,
 * two surfaces: the security page keeps its compact list, and this is the room
 * where a device can be understood rather than only ended.
 */
export const dynamic = "force-dynamic";

export default function DevicesPage() {
  return (
    <SettingsPage
      title="Connected devices"
      description="Where you are signed in, how far each device is trusted, and what that lets it do."
      bare
    >
      <ConnectedDevices />
    </SettingsPage>
  );
}
