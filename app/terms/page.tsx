import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms governing your use of FrenzSave — acceptable use, your responsibilities, and our liability.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <PageShell title="Terms of Service" updated="June 20, 2026">
      <p>
        Welcome to FrenzSave. By accessing or using our website and tools
        (the “Service”), you agree to these Terms of Service. If you do not
        agree, please do not use the Service.
      </p>

      <h2>1. What the Service does</h2>
      <p>
        FrenzSave is a tool that lets you fetch and save publicly available
        media from supported platforms by pasting a link. We do not host, store,
        or distribute any third-party content; we simply help you retrieve media
        you request.
      </p>

      <h2>2. Your responsibilities</h2>
      <ul>
        <li>
          You may only download content that you own, that is in the public
          domain, or that you have explicit permission to download.
        </li>
        <li>
          You are solely responsible for complying with the terms of service of
          the source platform and all applicable copyright and other laws.
        </li>
        <li>
          You agree not to use the Service to infringe intellectual property
          rights, violate privacy, or for any unlawful purpose.
        </li>
      </ul>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Abuse, overload, or attempt to disrupt the Service;</li>
        <li>Use automated systems to scrape or hammer our endpoints;</li>
        <li>Resell or commercially exploit the Service without permission;</li>
        <li>Circumvent rate limits or security measures.</li>
      </ul>

      <h2>4. Intellectual property</h2>
      <p>
        The media you download belongs to its respective owners. FrenzSave
        claims no ownership over downloaded content and grants no rights to it.
        The Service itself, including its branding and design, remains our
        property.
      </p>

      <h2>5. No warranty</h2>
      <p>
        The Service is provided “as is” and “as available,” without warranties
        of any kind. We do not guarantee that downloads will always succeed, that
        the Service will be uninterrupted, or that it is error-free.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, FrenzSave shall not be
        liable for any indirect, incidental, or consequential damages, or for any
        misuse of the Service or content obtained through it. You use the Service
        at your own risk and discretion.
      </p>

      <h2>7. Changes</h2>
      <p>
        We may update these Terms from time to time. Continued use of the Service
        after changes become effective constitutes acceptance of the revised
        Terms.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions about these Terms? Email{" "}
        <a href="mailto:support@frenzsave.com">support@frenzsave.com</a>
        .
      </p>

      <p>
        <em>
          This document is provided as a general template and does not constitute
          legal advice. Please have it reviewed by a qualified attorney before
          relying on it.
        </em>
      </p>
    </PageShell>
  );
}
