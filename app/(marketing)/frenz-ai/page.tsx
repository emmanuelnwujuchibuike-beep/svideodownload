import type { Metadata } from "next";

import { GuideGrid, GuidePage, guideMetadata } from "@/features/seo/guide-page";
import { guideByPath, guidesIn } from "@/lib/seo/guides";

/**
 * /frenz-ai — the PUBLIC explainer for Frenz AI (SEO, 2026-10-09).
 *
 * Static HTML from lib/seo/guides.ts: no generation code, no account read, no
 * database request on view. The tools themselves stay at /ai (noindex, gated);
 * this page explains them and hands over with a plain link. See lib/seo/guides.ts.
 */
export const dynamic = "force-static";

const hub = guideByPath("/frenz-ai")!;

export const metadata: Metadata = guideMetadata(hub);

export default function FrenzAiHubPage() {
  const all = guidesIn("frenz-ai");
  return (
    <GuidePage guide={hub}>
      <section className="mt-12">
        <h2 className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">Tools and guides</h2>
        <GuideGrid guides={all.filter((g) => !g.article)} />
        <h3 className="mt-8 text-[16px] font-semibold">Tutorials</h3>
        <GuideGrid guides={all.filter((g) => g.article)} />
      </section>
    </GuidePage>
  );
}
