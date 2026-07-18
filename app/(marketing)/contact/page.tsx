import type { Metadata } from "next";
import Link from "next/link";

import { PageShell } from "@/components/layout/page-shell";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with the FrenzSave team — support, copyright, and business enquiries.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <PageShell
      title="Contact us"
      subtitle="We're a small team and we read every message."
    >
      <p>
        Whether you&apos;ve hit a snag, want a platform added, or have a business
        idea — reach out using the right address below and we&apos;ll get back to
        you, usually within a couple of business days.
      </p>

      <h2>Support</h2>
      <p>
        Something not working, or a platform you&apos;d like supported?{" "}
        <a href="mailto:support@frenzsave.com">support@frenzsave.com</a>
      </p>

      <h2>Copyright &amp; DMCA</h2>
      <p>
        Copyright notices and takedown concerns:{" "}
        <a href="mailto:dmca@frenzsave.com">dmca@frenzsave.com</a> (see
        our <Link href="/dmca">DMCA policy</Link>).
      </p>

      <h2>Privacy</h2>
      <p>
        Data and privacy requests:{" "}
        <a href="mailto:privacy@frenzsave.com">privacy@frenzsave.com</a>
      </p>

      <h2>Business &amp; partnerships</h2>
      <p>
        Advertising, partnerships, or press:{" "}
        <a href="mailto:hello@frenzsave.com">hello@frenzsave.com</a>
      </p>
    </PageShell>
  );
}
