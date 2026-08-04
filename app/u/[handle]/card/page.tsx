import { ArrowLeft, Building2, Clock, Contact, Globe, Mail, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { IdentityBadges } from "@/components/badges/identity-badges";
import { CardShareActions } from "@/features/profile/card-share-actions";
import { ProfileQr } from "@/features/profile/profile-qr";
import { getUserPlan } from "@/lib/monetization/plan";
import { SITE_URL } from "@/lib/site";
import { getPublicProfile } from "@/lib/social/profile";
import { getProfileDetails } from "@/lib/social/profile-platform";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  return {
    title: `@${handle} — digital card`,
    // Not indexable: this is a sharing surface, and the profile itself is the
    // canonical page a search engine should hold.
    robots: { index: false, follow: false },
  };
}

/**
 * Digital Business Card™ (Feature 18 · Part 18).
 *
 * ── What the card is allowed to contain ──────────────────────────────────
 * Only what the member deliberately published. Contact details come from
 * their own Business fields, and the whole page is built from
 * `getPublicProfile`, which already applies visibility, blocks and suspension
 * for THIS viewer. A restricted profile has no card, so the card can never
 * become a way around a privacy setting the profile page honours — which is
 * the failure mode every "export" and "share" surface invites.
 *
 * ── The QR is generated here, not fetched ────────────────────────────────
 * `lib/qr/encode.ts` runs on this server. No third-party QR service is
 * involved, so nobody outside Frenz learns who is sharing which profile, and
 * the card works with no network beyond this page load.
 */
export default async function ProfileCardPage({ params }: { params: Promise<{ handle: string }> }) {
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
  if (!profile || profile.restricted) notFound();

  const [details, plan] = await Promise.all([getProfileDetails(profile.id), getUserPlan(profile.id)]);
  const url = `${SITE_URL}/u/${profile.handle}`;

  const location = [details.city, details.country].filter(Boolean).join(", ");
  const contacts = [
    details.contactEmail ? { Icon: Mail, label: details.contactEmail, href: `mailto:${details.contactEmail}` } : null,
    details.contactPhone ? { Icon: Phone, label: details.contactPhone, href: `tel:${details.contactPhone}` } : null,
    profile.website
      ? { Icon: Globe, label: profile.website.replace(/^https?:\/\//, ""), href: profile.website }
      : null,
    location ? { Icon: MapPin, label: location, href: null } : null,
    details.category ? { Icon: Building2, label: details.category, href: null } : null,
  ].filter(Boolean) as { Icon: typeof Mail; label: string; href: string | null }[];

  const openToday = details.hours?.some((h) => !h.closed);

  return (
    <main className="frenz-lux min-h-dvh px-4 py-6">
      <div className="mx-auto w-full max-w-md">
        <Link
          href={`/u/${profile.handle}`}
          className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to profile
        </Link>

        <article className="lux-card lux-header lux-enter overflow-hidden">
          {/* Cover strip — the member's banner, or the brand wash. */}
          <div className="relative h-24 w-full bg-gradient-to-br from-[#2563FF] to-[#6D5CFF]">
            {profile.bannerUrl ? (
              <Image src={profile.bannerUrl} alt="" fill sizes="448px" className="object-cover" />
            ) : null}
          </div>

          <div className="px-5 pb-5">
            <div className="-mt-10 flex items-end gap-3">
              <span className="lux-ring-glow relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-secondary ring-4 ring-card">
                {profile.avatarUrl ? (
                  <Image src={profile.avatarUrl} alt="" fill sizes="80px" className="object-cover" />
                ) : null}
              </span>
            </div>

            <h1 className="mt-3 flex flex-wrap items-center gap-2 text-xl font-bold tracking-[-0.02em]">
              {profile.displayName}
              <IdentityBadges verified={profile.isVerified} plan={plan} size="sm" />
            </h1>
            <p className="text-sm text-muted-foreground">@{profile.handle}</p>
            {details.headline ? <p className="mt-2 text-sm leading-relaxed">{details.headline}</p> : null}

            {contacts.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {contacts.map((c) => (
                  <li key={c.label}>
                    {c.href ? (
                      <a
                        href={c.href}
                        target={c.href.startsWith("http") ? "_blank" : undefined}
                        rel={c.href.startsWith("http") ? "nofollow noopener" : undefined}
                        className="lux-press flex items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-secondary/60"
                      >
                        <span className="lux-icon h-8 w-8">
                          <c.Icon className="h-4 w-4 text-[#2563FF]" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.label}</span>
                      </a>
                    ) : (
                      <span className="flex items-center gap-3 px-2 py-1.5">
                        <span className="lux-icon h-8 w-8">
                          <c.Icon className="h-4 w-4 text-[#6D5CFF]" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.label}</span>
                      </span>
                    )}
                  </li>
                ))}
                {openToday ? (
                  <li className="flex items-center gap-3 px-2 py-1.5">
                    <span className="lux-icon h-8 w-8">
                      <Clock className="h-4 w-4 text-emerald-500" />
                    </span>
                    <span className="text-sm font-medium">Opening hours on the profile</span>
                  </li>
                ) : null}
              </ul>
            ) : null}

            {/* QR — the whole point of the card. Centred, on white, with the
                spec's quiet zone, so it scans off a screen or in print. */}
            <div className="mt-5 flex flex-col items-center rounded-2xl bg-white p-4 ring-1 ring-inset ring-border">
              <ProfileQr value={url} label={`QR code for @${profile.handle}`} />
              <p className="mt-2 text-center text-xs font-medium text-neutral-500">
                Scan to open @{profile.handle}
              </p>
            </div>

            <CardShareActions
              handle={profile.handle}
              displayName={profile.displayName}
              url={url}
              vcardHref={`/u/${profile.handle}/vcard`}
            />
          </div>
        </article>

        <p className="mt-4 flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
          <Contact className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This card only shows what {profile.isOwner ? "you have" : "they have"} published. Contact details come from
          the profile&apos;s own Business fields.
        </p>
      </div>
    </main>
  );
}
