import Link from "next/link";

import { FooterTools } from "@/components/monetization/footer-tools";
import { SecretAdminGesture } from "@/features/account/secret-admin";
import { getPrimaryPages } from "@/lib/seo/seo-pages";

const DOWNLOADER_LINKS: [string, string][] = getPrimaryPages().map((d) => [
  `${d.brand} ${d.thing}`,
  `/${d.slug}`,
]);

export function SiteFooter() {
  return (
    <footer className="relative border-t border-border/40 pt-14 pb-10">
      {/* Top gradient line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border/80 to-transparent" />

      <div className="container grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-1">
          <SecretAdminGesture className="inline-flex items-center gap-2 text-lg font-bold tracking-tight">
            <span className="text-gradient">Frenz</span>
          </SecretAdminGesture>
          <p className="mt-3 max-w-[220px] text-sm leading-relaxed text-muted-foreground">
            Download and meet new friends with the latest news and reels. Fast,
            secure and watermark-free.
          </p>
        </div>

        <FooterColumn title="Downloaders" links={DOWNLOADER_LINKS} />
        <FooterColumn
          title="Product"
          links={[
            ["Home", "/"],
            ["Pricing", "/pricing"],
            ["Blog", "/blog"],
            ["FAQ", "/#faq"],
          ]}
        />
        <FooterColumn
          title="Developers"
          links={[
            ["API Docs", "/developers"],
            ["API Keys", "/account"],
          ]}
        />
        <FooterColumn
          title="Legal"
          links={[
            ["Terms", "/terms"],
            ["Privacy", "/privacy"],
            ["DMCA", "/dmca"],
            ["Contact", "/contact"],
          ]}
        />
      </div>

      {/* Admin-managed recommended tools (renders nothing when empty/disabled) */}
      <div className="container">
        <FooterTools />
      </div>

      <div className="container mt-12 flex flex-col items-start justify-between gap-3 border-t border-border/40 pt-6 text-xs text-muted-foreground/70 sm:flex-row sm:items-center">
        <p>
          © {new Date().getFullYear()} Frenz. Please respect platform
          terms and copyright. Download only content you have the right to save.
        </p>
        <p className="shrink-0">Built with precision &amp; care.</p>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: [string, string][];
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold tracking-wide">{title}</h3>
      <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="transition-colors hover:text-foreground">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
