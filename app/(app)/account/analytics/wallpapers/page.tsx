import type { Metadata } from "next";

import { PostsScreen } from "@/features/creator-analytics/screens/insights";

export const metadata: Metadata = { title: "Posts · Creator analytics", robots: { index: false, follow: false } };

/** Creator analytics — Posts (design/creator-analytics.html). Signed-in Business creators only: the layout gates it. */
export default function Page() {
  return <PostsScreen />;
}
