import type { Metadata } from "next";

import { OverviewScreen } from "@/features/creator-analytics/screens/overview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Creator analytics", robots: { index: false, follow: false } };

/** /account/analytics — the rebuilt Creator analytics overview (design/creator-analytics.html screen 1). The gate is the layout. */
export default function CreatorAnalyticsPage() {
  return <OverviewScreen />;
}
