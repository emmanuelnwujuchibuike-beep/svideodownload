import type { Metadata } from "next";

import { AudienceScreen } from "@/features/creator-analytics/screens/social";

export const metadata: Metadata = { title: "Audience · Creator analytics", robots: { index: false, follow: false } };

/** Creator analytics — Audience (design/creator-analytics.html). Signed-in Business creators only: the layout gates it. */
export default function Page() {
  return <AudienceScreen />;
}
