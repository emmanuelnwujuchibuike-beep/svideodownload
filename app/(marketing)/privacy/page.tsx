import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";

/*
 * Static by contract, not by inference. Vercel was building `/` as DYNAMIC while
 * this repo built it static, which silently made it uncacheable at the edge and
 * cost ~800-4700ms of TTFB before anyone noticed. This page reads no cookies, no
 * headers and no searchParams, so it declares that rather than hoping the builder
 * infers it. ISR still applies via `revalidate` in app/layout.tsx.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How FrenzSave handles your data. We collect the minimum needed to run the service and never store your downloads.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <PageShell title="Privacy Policy" updated="August 2, 2026">
      <p>
        Your privacy matters. This policy explains what FrenzSave processes,
        why, and how our advertising partners are involved.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li>
          <strong>Links you submit.</strong> The URL you paste is used to fetch
          metadata and prepare your download. We may cache extraction results
          briefly to speed up repeat requests; we do not build profiles from
          them.
        </li>
        <li>
          <strong>Your downloaded files are never stored.</strong> Media is
          streamed to you and not retained on our servers beyond the moment it
          takes to deliver it.
        </li>
        <li>
          <strong>Account &amp; profile information.</strong> If you create an
          account, we store what you choose to add to your profile — display
          name, username, bio, avatar/profile photo or video, status, and
          similar fields — plus your posts, messages, friend and follow
          relationships, and other activity on the social features of the
          Service.
        </li>
        <li>
          <strong>Private content you write.</strong> Features like your
          Private Journal and Time Capsule messages are visible only to you.
          We never display them to other users, and our own product surfaces
          are built so a sealed Time Capsule&apos;s contents are withheld
          until the date you chose.
        </li>
        <li>
          <strong>Technical data.</strong> We may process a truncated or hashed
          IP address and basic request data for rate limiting, security, and
          abuse prevention.
        </li>
        <li>
          <strong>Local preferences.</strong> Your theme choice and download
          history are stored in your browser&apos;s local storage — on your
          device, not our servers.
        </li>
        <li>
          <strong>Analytics.</strong> We may use privacy-respecting analytics to
          understand aggregate usage. These do not identify you personally.
        </li>
      </ul>

      <h2>2. How we use it</h2>
      <p>
        Solely to operate, secure, and improve the Service — to process your
        download requests, run the social features you choose to use, prevent
        abuse, and understand overall usage trends.
      </p>

      {/*
        🔴 Rewritten 2026-08-23 for ACCURACY (owner: the policy claimed AdSense
        was serving when it is not yet approved, and named Monetag when
        `DEFAULT_MONETIZATION.monetag` is `false`).

        A privacy policy that overstates what runs is a real problem, not a
        cosmetic one — it is the document a reviewer checks against observable
        behaviour, and naming a provider that is switched off is exactly the
        kind of mismatch that reads as boilerplate nobody maintains.

        What this now says is what is actually true today and stays true when
        approval lands, without needing a rewrite either way:
         • The Service is ad-supported (it is — see lib/monetization/settings).
         • Google's AdSense code IS present on the site. That part matters and
           must NOT be softened away: the site-level script in app/layout.tsx
           loads on every page whenever a publisher id is configured, whether
           or not ads are approved to serve, so it can set cookies TODAY. A
           policy claiming "no ad providers are active" would be its own,
           opposite inaccuracy.
         • Providers can change, and the accurate framing is "may", not a fixed
           roster that goes stale the moment a switch is flipped.

        Deliberately does NOT name Monetag or Adsterra. Both default to `false`
        and neither ships a script in that state. If either is ever switched
        back on, name it here — do not rely on the vague "partners" line to
        cover it.
      */}
      <h2>3. Advertising</h2>
      <p>
        FrenzSave is supported by advertising. Google AdSense code is present on
        the site, and we may work with other advertising partners over time; the
        providers we use can change as monetisation partners are enabled or
        retired. Advertising providers may use cookies, device identifiers, or
        similar technologies to serve ads, measure their performance, and limit
        how often you see the same ad. Google&apos;s use of advertising cookies
        enables it and its partners to serve ads based on your visits to this
        and other sites; you can opt out of personalised advertising by
        visiting{" "}
        <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">
          Google Ads Settings
        </a>{" "}
        or{" "}
        <a href="https://www.aboutads.info/choices" target="_blank" rel="noopener noreferrer">
          aboutads.info/choices
        </a>
        . We do not control these providers&apos; own data practices; please
        review their respective privacy policies for details.
      </p>

      <h2>4. Third-party services</h2>
      <p>
        {/*
          "named above" no longer parses — Section 3 deliberately stopped
          publishing a fixed roster (see its note), so a cross-reference to
          names that are no longer there would send a reader looking for a list
          that does not exist.
        */}
        We rely on infrastructure providers (such as hosting, CDN, and caching
        services) and on the advertising providers described in Section 3 to run
        the Service. These providers process data on our behalf, or on their own
        behalf for ad delivery, under their own security and privacy
        commitments.
      </p>

      <h2>5. Cookies &amp; local storage</h2>
      <p>
        We use local storage to remember your theme and recent downloads. Our
        advertising partners (Section 3) may separately set their own cookies
        or similar technologies in your browser to serve and measure ads.
      </p>

      <h2>6. Data retention</h2>
      <p>
        Cached metadata is short-lived. Technical logs are kept only as long as
        needed for security and then discarded. Local data stays on your device
        until you clear it. Account content (profile, posts, messages, journal
        and capsule entries) is retained until you delete it or close your
        account.
      </p>

      <h2>7. Your rights</h2>
      <p>
        Depending on your location (e.g. under GDPR or CCPA), you may have rights
        to access, correct, or delete personal data we hold about you, including
        requesting deletion of your account and its content. You can also
        control ad personalisation directly with the providers linked in
        Section 3.
      </p>

      <h2>8. Children</h2>
      <p>
        The Service is not directed to children under 13, and we do not knowingly
        collect their data.
      </p>

      <h2>9. Changes</h2>
      <p>
        We may update this policy as the Service evolves. Material changes will be
        reflected by the “last updated” date above.
      </p>

      <h2>10. Contact</h2>
      <p>
        Privacy questions? Email{" "}
        <a href="mailto:privacy@frenzsave.com">privacy@frenzsave.com</a>
        .
      </p>

      <p>
        <em>
          This document is a general template and not legal advice; please have
          it reviewed by a qualified professional.
        </em>
      </p>
    </PageShell>
  );
}
