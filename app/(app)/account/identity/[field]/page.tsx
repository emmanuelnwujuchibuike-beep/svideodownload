import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { getIdentityField } from "@/features/social/identity-fields";
import { IdentityFieldEditor } from "@/features/social/identity-field-editor";
import { getOwnProfile, getProfileExtras, getProfileMedia } from "@/lib/social/profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ field: string }> }): Promise<Metadata> {
  const { field } = await params;
  const spec = getIdentityField(field);
  return { title: spec?.title ?? "Identity", robots: { index: false, follow: false } };
}

/**
 * One Identity field on its own screen — the drill-down target of the list on
 * /account/identity, matching the owner's reference (public/profile settings.jpg).
 *
 * A single dynamic route rather than ten hand-written ones: the field table in
 * `identity-fields.ts` is the whole registry, so an unknown slug 404s instead of
 * rendering an empty page, and adding a field is one entry in one array.
 */
export default async function IdentityFieldPage({ params }: { params: Promise<{ field: string }> }) {
  const { field } = await params;
  const spec = getIdentityField(field);
  if (!spec) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [profile, extras, media] = await Promise.all([
    getOwnProfile(user.id),
    getProfileExtras(user.id),
    getProfileMedia(user.id),
  ]);
  if (!profile) redirect("/account");

  return (
    <SettingsPage title={spec.title} description={spec.help ?? spec.description} backHref="/account/identity" bare>
      <div className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm sm:p-5">
        <IdentityFieldEditor
          field={spec.key}
          values={{
            displayName: profile.displayName ?? "",
            handle: profile.handle ?? "",
            bio: profile.bio ?? "",
            website: profile.website ?? "",
            visibility: profile.visibility,
            status: extras?.status ?? "",
            mood: extras?.mood ?? "",
            accent: extras?.accent ?? "",
            videoUrl: media?.videoUrl ?? "",
            avatarMediaUrl: media?.avatarUrl ?? "",
            identityMode: media?.identityMode ?? "photo",
          }}
        />
      </div>
    </SettingsPage>
  );
}
