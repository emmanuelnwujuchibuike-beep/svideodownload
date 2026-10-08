import type { Metadata } from "next";

import { SiteHeader } from "@/components/layout/site-header";
import { AdvertiseWizard } from "@/features/ads-platform/advertise-wizard";

/*
  Static shell: no cookie is read here (the marketing header is static, and the
  wizard learns who is signed in on the client), so this is never a per-visit
  render. Under (marketing), not (app): a guest can explore formats, prices and
  durations before signing in — sign-in is asked for at the upload step.
*/
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Create an ad — Frenzsave",
  description: "Choose a format, placement and duration, upload your creative and preview your ad.",
  alternates: { canonical: "/advertise/create" },
  robots: { index: false, follow: true },
};

export default function CreateAdPage() {
  return (
    <>
      <SiteHeader />
      <main className="bg-background">
        <div className="mx-auto w-full max-w-xl px-4 pb-28 pt-[calc(var(--frenz-safe-top)+4.75rem)] sm:pt-[calc(var(--frenz-safe-top)+6rem)]">
          <h1 className="sr-only">Create an ad</h1>
          <AdvertiseWizard />
        </div>
      </main>
    </>
  );
}
