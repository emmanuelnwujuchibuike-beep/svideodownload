import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { OfferingsEditor } from "@/features/profile/offerings-editor";
import { ProfileDetailsEditor } from "@/features/profile/profile-details-editor";
import { isCommercialType } from "@/lib/profile/profile-types";
import { getProfileDetails, getProfileIdentity, listOfferings } from "@/lib/social/profile-platform";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Business", robots: { index: false, follow: false } };

/**
 * Business Profile™ — the company's overview, contact details, opening hours
 * and catalogue (Feature 18 · Part 14).
 *
 * Reachable whatever the member's current type: they may want to fill this in
 * BEFORE switching to Business, and everything they write is kept when they
 * switch away. A banner says plainly whether it is currently on show.
 */
export default async function BusinessSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [identity, details, offerings] = await Promise.all([
    getProfileIdentity(user.id),
    getProfileDetails(user.id),
    listOfferings(user.id),
  ]);
  const shown = isCommercialType(identity.type);

  return (
    <SettingsPage title="Business" description="Your company overview, contact details, hours and catalogue." bare>
      {!shown ? (
        <p className="mb-4 rounded-2xl border border-dashed border-border/70 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
          Your profile type is not Business, so these sections aren&apos;t on your profile right now. You can still fill
          them in — nothing is lost.{" "}
          <Link href="/account/profile-type" prefetch className="font-semibold text-primary hover:underline">
            Switch to a Business profile
          </Link>{" "}
          when you&apos;re ready.
        </p>
      ) : null}

      <div className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
        <ProfileDetailsEditor section="business" details={details} />
      </div>

      <div className="mt-5">
        <OfferingsEditor initial={offerings} />
      </div>
    </SettingsPage>
  );
}
