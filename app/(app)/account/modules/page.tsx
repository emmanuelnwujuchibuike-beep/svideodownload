import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SettingsPage } from "@/features/account/settings-page";
import { ProfileModulesEditor } from "@/features/profile/profile-modules-editor";
import { effectiveModules } from "@/lib/profile/engine";
import type { ModuleKey } from "@/lib/profile/modules";
import { profileType } from "@/lib/profile/profile-types";
import { listCircles } from "@/lib/social/graph/store";
import { getProfileIdentity, getProfileModules } from "@/lib/social/profile-platform";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Profile sections", robots: { index: false, follow: false } };

/**
 * Smart Profile Modules™ — build the profile out of the sections you want
 * (Feature 18 · Part 14).
 */
export default async function ProfileModulesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [identity, stored, circles] = await Promise.all([
    getProfileIdentity(user.id),
    getProfileModules(user.id),
    listCircles(user.id),
  ]);
  const spec = profileType(identity.type);
  const modules = effectiveModules(identity.type, stored);
  // A landing module the member no longer offers (they switched type) must not
  // be presented as selected — the engine falls back the same way.
  const landing = modules.some((m) => m.key === identity.landingModule)
    ? (identity.landingModule as ModuleKey)
    : null;

  return (
    <SettingsPage
      title="Profile sections"
      description="Choose what your profile shows, in what order, and to whom."
      bare
    >
      <p className="mb-4 rounded-2xl bg-secondary/40 px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
        These are the sections a <span className="font-semibold text-foreground">{spec.label}</span> profile offers.{" "}
        <Link href="/account/profile-type" prefetch className="font-semibold text-primary hover:underline">
          Change your profile type
        </Link>{" "}
        to offer different ones. A section you turn on but leave empty stays hidden from visitors — only you see it,
        so you always know it&apos;s there to fill in.
        {circles.length > 0 ? (
          <>
            {" "}
            You can also show a section to one of your{" "}
            <Link href="/friends/circles" prefetch className="font-semibold text-primary hover:underline">
              circles
            </Link>{" "}
            only.
          </>
        ) : null}
      </p>

      <ProfileModulesEditor
        type={identity.type}
        modules={modules}
        landing={landing}
        circles={circles.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
      />
    </SettingsPage>
  );
}
