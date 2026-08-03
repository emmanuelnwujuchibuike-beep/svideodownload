import {
  AtSign,
  Eye,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Palette,
  Pencil,
  Smile,
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SettingsGroup, SettingsRow } from "@/features/account/settings-ui";
import { SettingsPage } from "@/features/account/settings-page";
import { IDENTITY_FIELDS, type IdentityFieldSpec } from "@/features/social/identity-fields";
import { IdentityHero } from "@/features/social/identity-hero";
import type { BillingPlan } from "@/lib/monetization/types";
import { getUserPlan } from "@/lib/monetization/plan";
import { getOwnProfile, getProfileExtras, getProfileMedia } from "@/lib/social/profile";
import { getVerificationState } from "@/lib/social/verification";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Identity", robots: { index: false, follow: false } };

const ICONS: Record<string, LucideIcon> = {
  Video,
  UserRound,
  Image: ImageIcon,
  Eye,
  Pencil,
  AtSign,
  FileText,
  Smile,
  Palette,
  Link: LinkIcon,
};

const VISIBILITY_LABEL: Record<string, string> = {
  public: "Everyone",
  followers: "Followers",
  private: "Only me",
};

/**
 * Identity — the owner's reference (public/profile settings.jpg) is a LIST, not a
 * form: every row shows its current value and a chevron, and tapping it opens
 * that field's own screen. The editing controls used to all sit inline on this
 * one page behind a single "Save changes" button at the bottom.
 */
export default async function IdentitySettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [ownProfile, extras, media, plan, verification] = await Promise.all([
    getOwnProfile(user.id),
    getProfileExtras(user.id),
    getProfileMedia(user.id),
    getUserPlan(user.id),
    // `OwnProfile` is the editable field set and deliberately carries no tick;
    // the hero reads it from the verification state instead.
    getVerificationState(user.id),
  ]);

  // The value shown on the right of each row — the whole point of a list like
  // this is that you can read your settings without opening anything.
  const valueFor = (f: IdentityFieldSpec): string => {
    switch (f.key) {
      case "video":
        return media?.videoUrl ? "Added" : "Add video";
      case "avatar":
        return media?.avatarUrl ? "Added" : "Add avatar";
      case "display-mode":
        return (media?.identityMode ?? "photo").replace(/^./, (c) => c.toUpperCase());
      case "visibility":
        return VISIBILITY_LABEL[ownProfile?.visibility ?? "public"] ?? "Everyone";
      case "name":
        return ownProfile?.displayName || "Not set";
      case "username":
        return ownProfile?.handle ? `@${ownProfile.handle}` : "Not set";
      case "bio":
        return ownProfile?.bio ? "Written" : "Not set";
      case "status":
        return extras?.status || extras?.mood || "Not set";
      case "accent":
        return extras?.accent ? "Custom" : "Default";
      case "links":
        return ownProfile?.website ? ownProfile.website.replace(/^https?:\/\//, "") : "Not set";
      default:
        return "";
    }
  };

  const group = (id: "identity" | "details") =>
    IDENTITY_FIELDS.filter((f) => f.group === id).map((f) => (
      <SettingsRow
        key={f.key}
        icon={ICONS[f.icon] ?? Pencil}
        tint={f.tint}
        title={f.title}
        tag={f.tag}
        description={f.description}
        right={<span className="max-w-[9rem] truncate text-muted-foreground">{valueFor(f)}</span>}
        href={`/account/identity/${f.key}`}
        chevron
      />
    ));

  return (
    <SettingsPage title="Identity" description="Manage how you appear across Frenzsave." bare>
      <IdentityHero
        handle={ownProfile?.handle ?? null}
        displayName={ownProfile?.displayName ?? null}
        bannerUrl={ownProfile?.bannerUrl ?? null}
        avatarUrl={ownProfile?.avatarUrl ?? null}
        verified={verification.verified}
        plan={plan as BillingPlan}
      />

      <SettingsGroup label="DIGITAL IDENTITY" description="Customize the elements that define you.">
        {group("identity")}
      </SettingsGroup>

      <SettingsGroup label="DETAILS">{group("details")}</SettingsGroup>
    </SettingsPage>
  );
}
