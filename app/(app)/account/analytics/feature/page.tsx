import type { Metadata } from "next";

import { FeatureScreen } from "@/features/creator-analytics/screens/insights";

export const metadata: Metadata = { title: "Feature of the month · Creator analytics", robots: { index: false, follow: false } };

/** Creator analytics — Feature of the month (design/creator-analytics.html). Signed-in Business creators only: the layout gates it. */
export default function Page() {
  return <FeatureScreen />;
}
