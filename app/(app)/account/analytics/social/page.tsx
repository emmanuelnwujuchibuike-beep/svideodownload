import type { Metadata } from "next";

import { SocialScreen } from "@/features/creator-analytics/screens/social";

export const metadata: Metadata = { title: "Social engagement · Creator analytics", robots: { index: false, follow: false } };

/** Creator analytics — Social engagement (design/creator-analytics.html). Signed-in Business creators only: the layout gates it. */
export default function Page() {
  return <SocialScreen />;
}
