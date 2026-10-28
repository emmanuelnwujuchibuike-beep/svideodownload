import type { Metadata } from "next";

import { GiftingScreen } from "@/features/creator-analytics/screens/money";

export const metadata: Metadata = { title: "Gifting · Creator analytics", robots: { index: false, follow: false } };

/** Creator analytics — Gifting (design/creator-analytics.html). Signed-in Business creators only: the layout gates it. */
export default function Page() {
  return <GiftingScreen />;
}
