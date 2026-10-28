import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PostInsightsScreen } from "@/features/creator-analytics/screens/insights";

export const metadata: Metadata = { title: "Post insights · Creator analytics", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Creator analytics — one post's insights (design screen 5a). Only the creator's own post answers (the API checks). */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <PostInsightsScreen id={id} />;
}
