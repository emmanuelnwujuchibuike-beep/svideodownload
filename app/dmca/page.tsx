import type { Metadata } from "next";

import { PageShell } from "@/components/layout/page-shell";

export const metadata: Metadata = {
  title: "DMCA & Copyright Policy",
  description:
    "SVideoDownload respects copyright. We are a tool and do not host content. How to report concerns.",
  alternates: { canonical: "/dmca" },
};

export default function DmcaPage() {
  return (
    <PageShell title="DMCA & Copyright Policy" updated="June 20, 2026">
      <p>
        SVideoDownload respects the intellectual property rights of others and
        expects users to do the same.
      </p>

      <h2>We do not host content</h2>
      <p>
        SVideoDownload is a tool that retrieves publicly available media at a
        user&apos;s request. We do not store, host, cache long-term, or
        distribute any third-party media files. Content remains hosted on its
        original source platform.
      </p>

      <h2>Your responsibility</h2>
      <p>
        You must only download content you own or are otherwise authorized to
        download. Using the Service to reproduce or distribute copyrighted
        material without permission is prohibited and is your sole
        responsibility.
      </p>

      <h2>Reporting copyright concerns</h2>
      <p>
        Because we do not host content, the most effective way to remove
        infringing material is to contact the platform that hosts it. However, if
        you believe the Service is being used to facilitate infringement of your
        work, you may send a notice including:
      </p>
      <ul>
        <li>Your contact information;</li>
        <li>Identification of the copyrighted work concerned;</li>
        <li>The specific URL(s) or material at issue;</li>
        <li>
          A statement, made in good faith, that the use is not authorized by the
          copyright owner, its agent, or the law;
        </li>
        <li>
          A statement that the information in your notice is accurate, and that
          you are the owner or authorized to act on the owner&apos;s behalf.
        </li>
      </ul>

      <h2>Counter-notice</h2>
      <p>
        If you believe a notice was filed in error, you may submit a
        counter-notice with the corresponding information and a good-faith
        statement.
      </p>

      <h2>Repeat infringers</h2>
      <p>
        We may restrict or terminate access for users who repeatedly misuse the
        Service to infringe copyright.
      </p>

      <h2>Contact our designated agent</h2>
      <p>
        Send notices to{" "}
        <a href="mailto:dmca@svideodownload.com">dmca@svideodownload.com</a>.
      </p>

      <p>
        <em>
          This document is a general template and not legal advice. Please have a
          qualified attorney review your copyright procedures.
        </em>
      </p>
    </PageShell>
  );
}
