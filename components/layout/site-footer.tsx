import { Facebook, Instagram, Send, Youtube } from "lucide-react";
import Link from "next/link";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/i18n/locales";
import { translator } from "@/lib/i18n/messages";
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
function NewsletterForm({ t }: { t: Translate }) {
  return (
    <form action="/contact" method="get" className="mt-4 flex items-center gap-2">
      <label htmlFor="footer-email" className="sr-only">
        {t("footer.emailLabel")}
      </label>
      <input
        id="footer-email"
        name="email"
        type="email"
        required
        placeholder={t("footer.emailPlaceholder")}
        className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-foreground/30"
      />
      <button
        type="submit"
        aria-label={t("footer.subscribe")}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 text-white transition hover:opacity-95 active:scale-[0.98]"
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}

/** Bound translator, threaded to the sub-components rather than re-derived. */
type Translate = ReturnType<typeof translator>;

/**
 * `locale` is a prop with a default rather than a read of request state.
 *
 * The footer renders on `/`, which is `force-static`. Reading a cookie or a
 * header here to detect a language would opt the whole route out of static
 * generation — the exact defect that cost the front door its CDN caching. When a
 * second locale is genuinely translated, the locale arrives through routing (a
 * path prefix, prerendered per language) and is passed down; this signature does
 * not change.
 */
export function SiteFooter({ locale = DEFAULT_LOCALE }: { locale?: LocaleCode } = {}) {
  const t = translator(locale);

  return (
    <footer className="relative border-t border-border/40 pt-14 pb-10">
      {/* Top gradient line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border/80 to-transparent" />

      {/* Six tracks, not five — the Learn column was added and an explicit
          template silently overflows if the count drifts from the children.
          Three-up at md keeps the columns readable before the full row fits. */}
      <div className="container grid gap-10 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr_1.5fr]">
        <div>
          <SecretAdminGesture className="inline-flex items-center gap-2 text-lg font-bold tracking-tight">
            <FrenzLogo size={28} />
            <span className="text-gradient">Frenz</span>
          </SecretAdminGesture>
          <p className="mt-3 max-w-[240px] text-sm leading-relaxed text-muted-foreground">
            {t("footer.blurb")}
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
          title={t("footer.products")}
          links={[
            ["Download", "/downloads"],
            ["Community", "/home"],
            ["Pricing", "/pricing"],
            ["Developers", "/developers"],
          ]}
        />
        <FooterColumn
          title={t("footer.company")}
          links={[
            ["About Us", "/about"],
            ["Blog", "/blog"],
            ["Contact", "/contact"],
          ]}
        />
        {/*
          Learn and Support are separate columns because they answer different
          questions. Someone browsing wants the Academy; someone mid-problem wants
          the Trust Center, and burying "who can see my profile" under a heading
          called Learn is how trust content goes unread.
        */}
        <FooterColumn
          title={t("footer.learn")}
          links={[
            ["Academy", "/academy"],
            ["Guides", "/learn"],
            ["Glossary", "/glossary"],
          ]}
        />
        <FooterColumn
          title={t("footer.support")}
          links={[
            ["Help Center", "/help"],
            ["Trust Center", "/trust"],
            ["FAQ", "/#faq"],
            ["Privacy Policy", "/privacy"],
            ["Terms of Service", "/terms"],
            ["DMCA", "/dmca"],
          ]}
        />

        {/* Stay in the Loop — the mockup's newsletter capture. */}
        <div>
          <h3 className="text-sm font-semibold tracking-wide">{t("footer.newsletterTitle")}</h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t("footer.newsletterBody")}
          </p>
          <NewsletterForm t={t} />
        </div>
      </div>

      {/* Admin-managed recommended tools (renders nothing when empty/disabled) */}
      <div className="container">
        <FooterTools />
      </div>

      <div className="container mt-12 flex flex-col items-start justify-between gap-3 border-t border-border/40 pt-6 text-xs text-muted-foreground/70 sm:flex-row sm:items-center">
        <p>
          {t("footer.copyright", { year: new Date().getFullYear() })}
        </p>
        <p className="shrink-0">{t("footer.builtWith")}</p>
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
