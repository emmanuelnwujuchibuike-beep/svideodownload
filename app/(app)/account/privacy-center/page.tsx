import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PrivacyCenterPage } from "@/features/privacy/privacy-center";
import { privacyCenter } from "@/lib/privacy/center";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Privacy Center", robots: { index: false, follow: false } };

/** /account/privacy-center — Relationship Privacy Center™ (Feature 19 · Part 17). One read; every control saves on the tap. */
export default async function PrivacyCenterRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/privacy-center");
  const center = await privacyCenter(user.id);
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-3 pt-4 sm:px-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <PrivacyCenterPage initial={center} />
    </div>
  );
}
