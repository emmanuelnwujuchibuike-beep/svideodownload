import { buildVCard, vCardFilename } from "@/lib/profile/vcard";
import { getPublicProfile } from "@/lib/social/profile";
import { getProfileDetails } from "@/lib/social/profile-platform";
import { SITE_URL } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Profile Export™ — download this profile as a contact card (Feature 18 · Part 14).
 *
 * PRIVACY: the card is built from `getPublicProfile`, which already applies
 * visibility, blocks and suspension for this viewer — so a restricted profile
 * exports nothing, and the export can never become a way around a privacy
 * setting the profile page itself honours. Contact details come from the
 * member's own Business fields, which they published deliberately.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  let viewer: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    viewer = user?.id ?? null;
  } catch {
    viewer = null;
  }

  const profile = await getPublicProfile(handle, viewer);
  if (!profile) return new Response("Not found", { status: 404 });
  // A private/followers-only profile this viewer can't see has nothing to export.
  if (profile.restricted) return new Response("Not available", { status: 403 });

  const details = await getProfileDetails(profile.id);

  const vcard = buildVCard({
    displayName: profile.displayName,
    handle: profile.handle,
    headline: details.headline,
    organization: details.category,
    email: details.contactEmail,
    phone: details.contactPhone,
    website: profile.website,
    address: details.address,
    city: details.city,
    country: details.country,
    note: profile.bio,
    profileUrl: `${SITE_URL}/u/${profile.handle}`,
    avatarUrl: profile.avatarUrl,
  });

  return new Response(vcard, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${vCardFilename(profile.handle)}"`,
      // Per-viewer (privacy is applied above), and cheap to regenerate.
      "Cache-Control": "private, no-store",
    },
  });
}
