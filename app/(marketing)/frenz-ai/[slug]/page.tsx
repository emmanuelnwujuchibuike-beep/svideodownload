import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GuidePage, guideMetadata } from "@/features/seo/guide-page";
import { guideSlug, guidesIn } from "@/lib/seo/guides";

/** /frenz-ai/<slug> — one Frenz AI tool explainer, Kling page or tutorial. Static; unknown slugs 404. */
export const dynamic = "force-static";
export const dynamicParams = false;

const find = (slug: string) => guidesIn("frenz-ai").find((g) => guideSlug(g) === slug);

export function generateStaticParams() {
  return guidesIn("frenz-ai").map((g) => ({ slug: guideSlug(g)! }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = find((await params).slug);
  return g ? guideMetadata(g) : {};
}

export default async function FrenzAiGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const g = find((await params).slug);
  if (!g) notFound();
  return <GuidePage guide={g} />;
}
