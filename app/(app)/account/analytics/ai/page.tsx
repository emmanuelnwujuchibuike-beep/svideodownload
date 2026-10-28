import type { Metadata } from "next";

import { AIScreen } from "@/features/creator-analytics/screens/insights";

export const metadata: Metadata = { title: "AI creations · Creator analytics", robots: { index: false, follow: false } };

/** Creator analytics — AI creations (design/creator-analytics.html). Signed-in Business creators only: the layout gates it. */
export default function Page() {
  return <AIScreen />;
}
