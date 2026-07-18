import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How FrenzSave handles your data. We collect the minimum needed to run the service and never store your downloads.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <PageShell title="Privacy Policy" updated="June 20, 2026">
      <p>
        Your privacy matters. FrenzSave is built to collect as little data
        as possible. This policy explains what we process and why.
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
        download requests, prevent abuse, and understand overall usage trends.
      </p>

      <h2>3. Third-party services</h2>
      <p>
        We rely on infrastructure providers (such as hosting, CDN, and caching
        services) to run the Service. These providers process data on our behalf
        under their own security and privacy commitments.
      </p>

      <h2>4. Cookies &amp; local storage</h2>
      <p>
        We use local storage to remember your theme and recent downloads. We do
        not use advertising cookies that track you across other sites. If we
        introduce ads in the future, this policy will be updated accordingly.
      </p>

      <h2>5. Data retention</h2>
      <p>
        Cached metadata is short-lived. Technical logs are kept only as long as
        needed for security and then discarded. Local data stays on your device
        until you clear it.
      </p>

      <h2>6. Your rights</h2>
      <p>
        Depending on your location (e.g. under GDPR or CCPA), you may have rights
        to access, correct, or delete personal data we hold about you. Since we
        store very little, most data simply isn&apos;t retained — but you can
        contact us with any request.
      </p>

      <h2>7. Children</h2>
      <p>
        The Service is not directed to children under 13, and we do not knowingly
        collect their data.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update this policy as the Service evolves. Material changes will be
        reflected by the “last updated” date above.
      </p>

      <h2>9. Contact</h2>
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
