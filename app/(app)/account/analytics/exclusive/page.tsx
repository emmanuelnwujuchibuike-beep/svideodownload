import type { Metadata } from "next";

import { ExclusiveScreen } from "@/features/creator-analytics/screens/money";

export const metadata: Metadata = { title: "Exclusive post earnings · Creator analytics", robots: { index: false, follow: false } };

/** Creator analytics — Exclusive post earnings (design/creator-analytics.html). Signed-in Business creators only: the layout gates it. */
export default function Page() {
  return <ExclusiveScreen />;
}
