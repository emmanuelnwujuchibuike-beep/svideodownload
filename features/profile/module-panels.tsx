import {
  Award,
  BadgeCheck,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  Clock,
  Download,
  ExternalLink,
  FileText,
  GraduationCap,
  Globe,
  LayoutGrid,
  Mail,
  MapPin,
  Phone,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import {
  formatPrice,
  type Credential,
  type CredentialKind,
  type Offering,
  type OpeningHours,
  type ProfileDetails,
} from "@/lib/social/profile-platform";

/**
 * Module panels — what each Smart Profile Module™ actually renders
 * (Feature 18 · Part 14).
 *
 * Every panel here is a SERVER component with no client JavaScript. The tab
 * dock is a client component that switches instantly, and it receives these
 * already-rendered as props: that keeps the instant switching the profile has
 * always had, while adding zero fetch-on-tab-change and zero extra bundle.
 *
 * External links are `rel="nofollow noopener"` without exception — a profile is
 * user-submitted, so its links must never pass authority or hand a target
 * window a reference back to this page.
 */

const CARD = "rounded-3xl border border-border/70 bg-card p-5 shadow-sm";
const EMPTY = "rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground";

const KIND_META: Record<CredentialKind, { label: string; icon: LucideIcon }> = {
  project: { label: "Portfolio", icon: LayoutGrid },
  experience: { label: "Experience", icon: Briefcase },
  education: { label: "Education", icon: GraduationCap },
  certification: { label: "Certifications", icon: BadgeCheck },
  award: { label: "Awards", icon: Award },
  publication: { label: "Publications", icon: BookOpen },
};

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/* ─────────────────────────────── About ─────────────────────────────── */

export function AboutPanel({
  details,
  bio,
  website,
  joined,
  isOwner,
  typeLabel,
  handle,
}: {
  details: ProfileDetails;
  bio: string | null;
  website: string | null;
  joined: string;
  isOwner: boolean;
  typeLabel: string;
  handle: string;
}) {
  const contacts: { icon: LucideIcon; label: string; href?: string }[] = [];
  if (details.contactEmail) contacts.push({ icon: Mail, label: details.contactEmail, href: `mailto:${details.contactEmail}` });
  if (details.contactPhone) contacts.push({ icon: Phone, label: details.contactPhone, href: `tel:${details.contactPhone.replace(/\s/g, "")}` });
  if (website) contacts.push({ icon: Globe, label: website.replace(/^https?:\/\//, ""), href: website });
  const place = [details.address, details.city, details.country].filter(Boolean).join(", ");
  if (place) contacts.push({ icon: MapPin, label: place });

  const facts: { label: string; value: string }[] = [];
  if (details.category) facts.push({ label: "Field", value: details.category });
  if (details.founded) facts.push({ label: "Founded", value: details.founded });
  if (details.teamSize) facts.push({ label: "Team", value: details.teamSize });
  if (details.languages.length > 0) facts.push({ label: "Languages", value: details.languages.join(", ") });
  if (details.availability) {
    facts.push({
      label: "Availability",
      value:
        details.availability === "open"
          ? "Open to work"
          : details.availability === "selective"
            ? "Open to the right thing"
            : "Not available",
    });
  }

  const barren = !details.headline && !details.mission && !bio && contacts.length === 0 && facts.length === 0;

  return (
    <section className={CARD}>
      {details.headline ? <p className="text-lg font-semibold leading-snug">{details.headline}</p> : null}
      {details.mission ? (
        <p className="mt-2 whitespace-pre-line leading-relaxed text-muted-foreground">{details.mission}</p>
      ) : bio ? (
        <p className="mt-2 whitespace-pre-line leading-relaxed text-muted-foreground">{bio}</p>
      ) : null}

      {facts.length > 0 ? (
        <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{f.label}</dt>
              <dd className="mt-0.5 text-sm font-medium">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {contacts.length > 0 ? (
        <div className="mt-5 space-y-2 border-t border-border/60 pt-4">
          {contacts.map((c) => (
            <div key={c.label} className="flex items-center gap-2.5 text-sm">
              <c.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              {c.href ? (
                <a href={c.href} target="_blank" rel="nofollow noopener" className="truncate text-primary hover:underline">
                  {c.label}
                </a>
              ) : (
                <span className="truncate">{c.label}</span>
              )}
            </div>
          ))}

          {/* Profile Export™ — a real .vcf, straight into the phone's contacts.
              A plain <a download>: no JavaScript, works offline-first, and the
              route re-applies this profile's privacy before it emits anything. */}
          {details.contactEmail || details.contactPhone ? (
            <a
              href={`/u/${handle}/vcard`}
              download
              className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <Download className="h-3.5 w-3.5" /> Save contact card
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 pt-4 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Building2 className="h-4 w-4" />
          {typeLabel} profile
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4" />
          {joined}
        </span>
      </div>

      {barren && isOwner ? (
        <p className="mt-4 rounded-2xl border border-dashed border-border/70 px-4 py-3 text-xs text-muted-foreground">
          Only you can see how empty this is — visitors don&apos;t get an About tab until there&apos;s something in it.{" "}
          <Link href="/account/professional" prefetch className="font-semibold text-primary hover:underline">
            Add your details
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}

/* ──────────────────────────── Showcase ─────────────────────────────── */

/** Portfolio / Experience / Education / Certifications / Awards / Publications. */
export function ShowcasePanel({
  kind,
  items,
  isOwner,
}: {
  kind: CredentialKind;
  items: Credential[];
  isOwner: boolean;
}) {
  const meta = KIND_META[kind];
  if (items.length === 0) {
    return (
      <section className={CARD}>
        <Header icon={meta.icon} title={meta.label} />
        <p className={EMPTY}>
          {isOwner ? (
            <>
              Nothing here yet — visitors won&apos;t see this section until you add something.{" "}
              <Link href="/account/professional" prefetch className="font-semibold text-primary hover:underline">
                Add an entry
              </Link>
              .
            </>
          ) : (
            "Nothing here yet."
          )}
        </p>
      </section>
    );
  }

  // Projects read as a gallery; everything else reads as a timeline.
  if (kind === "project") {
    return (
      <section className={CARD}>
        <Header icon={meta.icon} title={meta.label} count={items.length} />
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((c) => (
            <article key={c.id} className="overflow-hidden rounded-2xl border border-border/60 bg-secondary/20">
              {c.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external, un-optimisable CDNs 403 through next/image
                <img src={c.imageUrl} alt="" className="h-36 w-full object-cover" loading="lazy" />
              ) : null}
              <div className="p-4">
                <h3 className="text-sm font-bold">{c.title}</h3>
                {c.organization ? <p className="mt-0.5 text-xs text-muted-foreground">{c.organization}</p> : null}
                {c.description ? <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{c.description}</p> : null}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">{dateRange(c)}</span>
                  {c.url ? (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="nofollow noopener"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      Open <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={CARD}>
      <Header icon={meta.icon} title={meta.label} count={items.length} />
      <ol className="space-y-4">
        {items.map((c) => (
          <li key={c.id} className="flex gap-3.5">
            <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-tile" />
            <div className="min-w-0 flex-1 border-b border-border/50 pb-4 last:border-0 last:pb-0">
              <h3 className="text-sm font-bold">{c.title}</h3>
              {c.organization ? <p className="mt-0.5 text-sm text-muted-foreground">{c.organization}</p> : null}
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{dateRange(c)}</p>
              {c.description ? <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{c.description}</p> : null}
              {c.url ? (
                <a
                  href={c.url}
                  target="_blank"
                  rel="nofollow noopener"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  View <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function dateRange(c: Credential): string {
  const end = c.isCurrent ? "Present" : c.endedOn;
  return [c.startedOn, end].filter(Boolean).join(" — ");
}

/* ───────────────────────── Skills · Résumé ─────────────────────────── */

export function SkillsPanel({ skills, isOwner }: { skills: string[]; isOwner: boolean }) {
  return (
    <section className={CARD}>
      <Header icon={LayoutGrid} title="Skills" count={skills.length || undefined} />
      {skills.length === 0 ? (
        <p className={EMPTY}>
          {isOwner ? (
            <>
              No skills listed.{" "}
              <Link href="/account/professional" prefetch className="font-semibold text-primary hover:underline">
                Add some
              </Link>
              .
            </>
          ) : (
            "No skills listed."
          )}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {skills.map((s) => (
            <li
              key={s}
              className="rounded-full bg-secondary/70 px-3 py-1.5 text-sm font-medium ring-1 ring-inset ring-border/50"
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ResumePanel({ url, isOwner }: { url: string | null; isOwner: boolean }) {
  return (
    <section className={CARD}>
      <Header icon={FileText} title="Résumé" />
      {url ? (
        <a href={url} target="_blank" rel="nofollow noopener" className="btn-lux btn-lux-primary">
          <FileText className="h-4 w-4" /> Open résumé
        </a>
      ) : (
        <p className={EMPTY}>
          {isOwner ? (
            <>
              No résumé linked.{" "}
              <Link href="/account/professional" prefetch className="font-semibold text-primary hover:underline">
                Add a link
              </Link>
              .
            </>
          ) : (
            "No résumé linked."
          )}
        </p>
      )}
    </section>
  );
}

/* ──────────────────────── Products · Services ──────────────────────── */

export function CatalogPanel({
  kind,
  items,
  isOwner,
}: {
  kind: "product" | "service";
  items: Offering[];
  isOwner: boolean;
}) {
  const title = kind === "product" ? "Products" : "Services";
  if (items.length === 0) {
    return (
      <section className={CARD}>
        <Header icon={LayoutGrid} title={title} />
        <p className={EMPTY}>
          {isOwner ? (
            <>
              Nothing listed yet.{" "}
              <Link href="/account/business" prefetch className="font-semibold text-primary hover:underline">
                Add a {kind}
              </Link>
              .
            </>
          ) : (
            "Nothing listed yet."
          )}
        </p>
      </section>
    );
  }

  return (
    <section className={CARD}>
      <Header icon={LayoutGrid} title={title} count={items.length} />
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((o) => {
          const price = formatPrice(o.priceMinor, o.currency);
          return (
            <article
              key={o.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-secondary/20"
            >
              {o.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- external, un-optimisable CDNs 403 through next/image
                <img src={o.imageUrl} alt="" className="h-36 w-full object-cover" loading="lazy" />
              ) : null}
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold">{o.name}</h3>
                  {!o.available ? (
                    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      Unavailable
                    </span>
                  ) : null}
                </div>
                {o.description ? (
                  <p className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground">{o.description}</p>
                ) : null}
                <div className="mt-3 flex items-end justify-between gap-2 pt-1">
                  {/* An unpriced item says so — it is never rendered as free. */}
                  <span className="text-sm font-bold">{price ?? <span className="text-muted-foreground">Contact for pricing</span>}</span>
                  {o.url ? (
                    <a href={o.url} target="_blank" rel="nofollow noopener" className="btn-lux btn-lux-secondary !px-3 !py-1.5 !text-xs">
                      {kind === "product" ? "Buy" : "Book"}
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ───────────────────────── Hours & location ────────────────────────── */

export function HoursPanel({ details, isOwner }: { details: ProfileDetails; isOwner: boolean }) {
  const place = [details.address, details.city, details.country].filter(Boolean).join(", ");
  const open = details.hours.filter((h) => !h.closed);

  if (open.length === 0 && !place) {
    return (
      <section className={CARD}>
        <Header icon={Clock} title="Hours & location" />
        <p className={EMPTY}>
          {isOwner ? (
            <>
              No hours or address set.{" "}
              <Link href="/account/business" prefetch className="font-semibold text-primary hover:underline">
                Add them
              </Link>
              .
            </>
          ) : (
            "No hours or address listed."
          )}
        </p>
      </section>
    );
  }

  const byDay = new Map<number, OpeningHours>(details.hours.map((h) => [h.day, h]));

  return (
    <section className={CARD}>
      <Header icon={Clock} title="Hours & location" />
      {open.length > 0 ? (
        <ul className="divide-y divide-border/50">
          {DAY_NAMES.map((name, day) => {
            const h = byDay.get(day);
            const closed = !h || h.closed;
            return (
              <li key={name} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium">{name}</span>
                <span className={closed ? "text-muted-foreground" : "font-semibold tabular-nums"}>
                  {closed ? "Closed" : `${h!.open} – ${h!.close}`}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {place ? (
        <div className="mt-4 border-t border-border/60 pt-4">
          <div className="flex items-start gap-2.5 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{place}</span>
          </div>
          {/* A search link, not an embedded map: an iframe from a third party on
              every business profile would be a tracker and a CWV cost on a page
              most visitors never scroll to. */}
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`}
            target="_blank"
            rel="nofollow noopener"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            Open in Maps <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : null}
    </section>
  );
}

/* ─────────────────────────────── shared ────────────────────────────── */

function Header({ icon: Icon, title, count }: { icon: LucideIcon; title: string; count?: number }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="h-[18px] w-[18px] text-muted-foreground" />
      <h2 className="text-base font-bold">{title}</h2>
      {count ? (
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{count}</span>
      ) : null}
    </div>
  );
}
