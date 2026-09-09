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
  title: "Terms of Service",
  description:
    "The terms governing your use of FrenzSave — acceptable use, your responsibilities, and our liability.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <PageShell title="Terms of Service" updated="September 9, 2026">
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

      {/*
        ── 🔴 THE AI SECTION, INSERTED AT 4 RATHER THAN APPENDED AT 9 ──────────

        Owner, 2026-09-09: "Add a proper Terms/Acceptable Use section covering
        AI tools. State clearly that users are responsible for having the
        necessary rights or permissions for media they upload."

        It sits directly after Acceptable Use and immediately before
        Intellectual property, because that is where it is READ. A terms page is
        skimmed by heading, and an AI clause tucked in after "Limitation of
        liability" is one nobody — a member, or a reviewer assessing whether
        this site should carry ads — will ever reach. The sections below it
        renumber, which is the correct cost.

        ⚠️ Every sentence here is a commitment the product must actually keep.
        The retention promise matches `feature.retentionHours` and the sweep in
        lib/ai/retention.ts; the "no public publishing" sentence is true because
        there is no publish path from an AI result at all; the rights sentence
        is the same one `AI_RIGHTS_NOTICE` shows at the point of upload. If any
        of those change, this changes with them.
      */}
      <h2>4. Frenz AI tools</h2>
      <p>
        Frenz AI provides media editing tools — including removing unwanted
        text, captions, logos and other visual distractions from video. These
        tools are provided for use on media you own or are permitted to edit.
      </p>
      <ul>
        <li>
          <strong>Your rights in the media.</strong> You are responsible for
          having the necessary rights or permissions for anything you upload or
          link to. Only process media you own or have permission to edit.
        </li>
        <li>
          You may not use Frenz AI to infringe copyright, to remove
          rights-management information, or to bypass platform restrictions or
          technical protection measures.
        </li>
        <li>
          You may not use Frenz AI to remove another creator&rsquo;s attribution
          in order to republish their work as your own, to remove security
          markings or legally required labels and warnings, or to process
          content that was obtained without permission.
        </li>
        <li>
          You may not use Frenz AI to create or edit sexual content involving
          minors, non-consensual intimate imagery, sexual deepfakes, or content
          intended to impersonate someone or facilitate fraud.
        </li>
        <li>
          We may refuse or stop processing a request that appears to fall
          outside these terms. Refusals are not accusations, and your access to
          the Service is unaffected.
        </li>
      </ul>
      <p>
        <strong>What we do with your files.</strong> Media you submit to Frenz
        AI is held in private storage that is not publicly readable, is reached
        only through short-lived signed links, and is deleted automatically
        after three days. Frenz AI results are private to you: nothing you
        process is published, listed, or shared by us. Frenz AI does not make
        any content downloadable that the source platform does not already
        serve, and does not defeat any copy protection.
      </p>

      <h2>5. Intellectual property</h2>
      <p>
        The media you download belongs to its respective owners. FrenzSave
        claims no ownership over downloaded content and grants no rights to it.
        The Service itself, including its branding and design, remains our
        property.
      </p>

      <h2>6. No warranty</h2>
      <p>
        The Service is provided “as is” and “as available,” without warranties
        of any kind. We do not guarantee that downloads will always succeed, that
        the Service will be uninterrupted, or that it is error-free.
      </p>

      <h2>7. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, FrenzSave shall not be
        liable for any indirect, incidental, or consequential damages, or for any
        misuse of the Service or content obtained through it. You use the Service
        at your own risk and discretion.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update these Terms from time to time. Continued use of the Service
        after changes become effective constitutes acceptance of the revised
        Terms.
      </p>

      <h2>9. Contact</h2>
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
