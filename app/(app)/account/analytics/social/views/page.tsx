import type { Metadata } from "next";

import { ViewsScreen } from "@/features/creator-analytics/screens/social";

export const metadata: Metadata = { title: "Views · Creator analytics", robots: { index: false, follow: false } };

/** Creator analytics — Views (design/creator-analytics.html). Signed-in Business creators only: the layout gates it. */
export default function Page() {
  return <ViewsScreen />;
}
