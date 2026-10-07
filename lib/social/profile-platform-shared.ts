import type { ModuleKey } from "@/lib/profile/modules";

export interface OpeningHours {
  /** 0 = Monday … 6 = Sunday. */
  day: number;
  open: string;
  close: string;
  closed: boolean;
}

export interface ProfileDetails {
  headline: string | null;
  category: string | null;
  mission: string | null;
  languages: string[];
  availability: string | null;
  skills: string[];
  resumeUrl: string | null;
  founded: string | null;
  teamSize: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  bookingUrl: string | null;
  quoteUrl: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  hours: OpeningHours[];
}

export const EMPTY_DETAILS: ProfileDetails = {
  headline: null,
  category: null,
  mission: null,
  languages: [],
  availability: null,
  skills: [],
  resumeUrl: null,
  founded: null,
  teamSize: null,
  contactEmail: null,
  contactPhone: null,
  bookingUrl: null,
  quoteUrl: null,
  address: null,
  city: null,
  country: null,
  hours: [],
};

export type CredentialKind =
  | "experience"
  | "education"
  | "certification"
  | "award"
  | "publication"
  | "project";

export const CREDENTIAL_KINDS: { kind: CredentialKind; label: string; module: ModuleKey; noun: string }[] = [
  { kind: "project", label: "Portfolio", module: "portfolio", noun: "project" },
  { kind: "experience", label: "Experience", module: "experience", noun: "role" },
  { kind: "education", label: "Education", module: "education", noun: "school" },
  { kind: "certification", label: "Certifications", module: "certifications", noun: "certification" },
  { kind: "award", label: "Awards", module: "awards", noun: "award" },
  { kind: "publication", label: "Publications", module: "publications", noun: "publication" },
];

export const CREDENTIAL_KIND_KEYS = CREDENTIAL_KINDS.map((c) => c.kind) as [CredentialKind, ...CredentialKind[]];

/** The module a credential kind feeds, so the engine and the editor agree. */
export const CREDENTIAL_MODULE: Record<CredentialKind, ModuleKey> = Object.fromEntries(
  CREDENTIAL_KINDS.map((c) => [c.kind, c.module]),
) as Record<CredentialKind, ModuleKey>;

export interface Credential {
  id: string;
  kind: CredentialKind;
  title: string;
  organization: string | null;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  startedOn: string | null;
  endedOn: string | null;
  isCurrent: boolean;
  position: number;
}

/** Group credentials by kind — what every showcase module renders from. */
export function credentialsByKind(list: Credential[]): Record<CredentialKind, Credential[]> {
  const out = Object.fromEntries(CREDENTIAL_KINDS.map((c) => [c.kind, [] as Credential[]])) as Record<
    CredentialKind,
    Credential[]
  >;
  for (const c of list) out[c.kind]?.push(c);
  return out;
}

/* ─────────────────────────── offerings ────────────────────────── */

export type OfferingKind = "product" | "service";

export interface Offering {
  id: string;
  kind: OfferingKind;
  name: string;
  description: string | null;
  priceMinor: number | null;
  currency: string;
  url: string | null;
  imageUrl: string | null;
  available: boolean;
  position: number;
}

/**
 * Money, formatted from minor units. Null price is NOT zero — a service
 * priced on enquiry says so, because rendering "₦0.00" would be a lie.
 */
export function formatPrice(priceMinor: number | null, currency: string): string | null {
  if (priceMinor === null) return null;
  const major = priceMinor / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: major % 1 === 0 ? 0 : 2,
    }).format(major);
  } catch {
    // An unknown currency code must not take the page down.
    return `${currency} ${major.toLocaleString()}`;
  }
}
