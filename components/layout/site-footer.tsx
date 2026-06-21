import Link from "next/link";

import { DOWNLOADERS } from "@/lib/seo/downloaders";

const DOWNLOADER_LINKS: [string, string][] = DOWNLOADERS.map((d) => [
  `${d.brand} ${d.noun}`,
  `/${d.slug}`,
]);

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 py-12">
      <div className="container grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <span className="text-lg font-bold">
            S<span className="text-gradient">Video</span>Download
          </span>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">
            Premium multi-platform video downloader. Fast, secure and
            watermark-free.
          </p>
        </div>

        <FooterColumn title="Downloaders" links={DOWNLOADER_LINKS} />
        <FooterColumn
          title="Product"
          links={[
            ["Home", "/"],
            ["Blog", "/blog"],
            ["FAQ", "/#faq"],
          ]}
        />
        <FooterColumn
          title="Legal"
          links={[
            ["Terms", "/terms"],
            ["Privacy", "/privacy"],
            ["DMCA", "/dmca"],
          ]}
        />
        <FooterColumn
          title="Company"
          links={[
            ["About", "/about"],
            ["Contact", "/contact"],
          ]}
        />
      </div>

      <div className="container mt-10 border-t border-border/60 pt-6 text-sm text-muted-foreground">
        <p>
          © {new Date().getFullYear()} SVideoDownload. Please respect platform
          terms and copyright. Download only content you have the right to save.
        </p>
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
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {links.map(([label, href]) => (
          <li key={label}>
            <Link href={href} className="transition hover:text-foreground">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
