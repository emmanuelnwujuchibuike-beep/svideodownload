import { Facebook, Instagram, Send, Youtube } from "lucide-react";
import Link from "next/link";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { FooterTools } from "@/components/monetization/footer-tools";
import { SecretAdminGesture } from "@/features/account/secret-admin";

/**
 * Social links, per the mockup's icon row.
 *
 * Only entries with a real  render. I do not know which accounts actually
 * exist, and a linked icon that 404s is chrome-level drift — the same defect class
 * the Reality Ledger catches in copy. Fill a URL in and the icon appears; leave it
 * empty and nothing ships. This is why the row can be empty today without looking
 * broken.
 */
const SOCIALS: { label: string; href: string; icon: typeof Facebook }[] = [
  { label: "Facebook", href: "", icon: Facebook },
  { label: "Instagram", href: "", icon: Instagram },
  { label: "YouTube", href: "", icon: Youtube },
].filter((s) => s.href.length > 0);

/**
 * Newsletter capture.
 *
 * A plain GET form to /contact with the address carried over — NOT a fake input.
 * There is no subscribe endpoint or subscriber table in this project, and an input
 * that swallows an email and reports nothing is worse than no input: the visitor
 * believes they signed up. This routes to a page that actually reaches someone,
 * needs no client JS, and works before hydration.
 *
 * Replace the action with a real endpoint when a subscriber list exists.
 */
function NewsletterForm() {
  return (
    <form action="/contact" method="get" className="mt-4 flex items-center gap-2">
      <label htmlFor="footer-email" className="sr-only">
        Email address
      </label>
      <input
        id="footer-email"
        name="email"
        type="email"
        required
        placeholder="Enter your email"
        className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/30"
      />
      <button
        type="submit"
        aria-label="Subscribe"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white transition hover:opacity-95 active:scale-[0.98]"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative border-t border-border/40 pt-14 pb-10">
      {/* Top gradient line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border/80 to-transparent" />

      <div className="container grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.6fr]">
        <div>
          <SecretAdminGesture className="inline-flex items-center gap-2 text-lg font-bold tracking-tight">
            <FrenzLogo size={28} />
            <span className="text-gradient">Frenz</span>
          </SecretAdminGesture>
          <p className="mt-3 max-w-[240px] text-sm leading-relaxed text-muted-foreground">
            Frenzsave is your all-in-one super app for downloading, creating, sharing and
            connecting. Save more. Do more. Be more.
          </p>
          {/* Social row, per the mockup. Only networks we actually publish on get a
              link; the rest would be a dead icon, which is chrome-level drift. */}
          <ul className="mt-5 flex items-center gap-2.5">
            {SOCIALS.map(({ label, href, icon: Icon }) => (
              <li key={label}>
                <Link
                  href={href}
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  <Icon className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <FooterColumn
          title="Products"
          links={[
            ["Download", "/downloads"],
            ["Community", "/home"],
            ["Pricing", "/pricing"],
            ["Developers", "/developers"],
          ]}
        />
        <FooterColumn
          title="Company"
          links={[
            ["About Us", "/about"],
            ["Blog", "/blog"],
            ["Contact", "/contact"],
          ]}
        />
        <FooterColumn
          title="Support"
          links={[
            ["FAQ", "/#faq"],
            ["Privacy Policy", "/privacy"],
            ["Terms of Service", "/terms"],
            ["DMCA", "/dmca"],
          ]}
        />

        {/* Stay in the Loop — the mockup's newsletter capture. */}
        <div>
          <h3 className="text-sm font-semibold tracking-wide">Stay in the Loop</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Get the latest updates, tips and offers straight to your inbox.
          </p>
          <NewsletterForm />
        </div>
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
