import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { CredentialsEditor } from "@/features/profile/credentials-editor";
import { ProfileDetailsEditor } from "@/features/profile/profile-details-editor";
import { isProfessionalType } from "@/lib/profile/profile-types";
import { getProfileDetails, getProfileIdentity, listCredentials } from "@/lib/social/profile-platform";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Professional", robots: { index: false, follow: false } };

/**
 * Professional Profile™ — the showcase: headline, skills, portfolio,
 * experience, education, certifications, awards and publications
 * (Feature 18 · Part 14).
 *
 * Like the Business screen, it is reachable from any profile type — a member
 * can build the showcase first and switch afterwards.
 */
export default async function ProfessionalSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [identity, details, credentials] = await Promise.all([
    getProfileIdentity(user.id),
    getProfileDetails(user.id),
    listCredentials(user.id),
  ]);
  const shown = isProfessionalType(identity.type);

  return (
    <SettingsPage title="Professional" description="Your portfolio, experience, education and credentials." bare>
      {!shown ? (
        <p className="mb-4 rounded-2xl border border-dashed border-border/70 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
          Some of these sections aren&apos;t offered by your current profile type, so they won&apos;t all appear on your
          profile yet. Fill them in anyway — nothing is lost.{" "}
          <Link href="/account/profile-type" prefetch className="font-semibold text-primary hover:underline">
            Change your profile type
          </Link>{" "}
          to show them.
        </p>
      ) : null}

      <div className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
        <ProfileDetailsEditor section="professional" details={details} />
      </div>

      <div className="mt-5">
        <CredentialsEditor initial={credentials} />
      </div>
    </SettingsPage>
  );
}
