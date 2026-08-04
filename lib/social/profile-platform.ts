import { DEFAULT_MODULE_AUDIENCE, type ModuleKey } from "@/lib/profile/modules";
import type { StoredModule } from "@/lib/profile/engine";
import { DEFAULT_PROFILE_TYPE, type ProfileTypeKey, profileType } from "@/lib/profile/profile-types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Universal Profile Engine™ — the data layer (Feature 18 · Part 14, migration 0107).
 *
 * Every read here is FAIL-CLOSED and INDEPENDENT, the pattern the profile has
 * used since `getProfileExtras`: each query stands alone in its own try/catch
 * and degrades to an empty/default value. That is deliberate and load-bearing —
 * migration 0107 has not been applied to production yet, and a profile page must
 * not 500 because a column or table isn't there. Until it is applied every
 * profile simply reads as a personal profile with its default modules, which is
 * exactly today's behaviour.
 *
 * These are also never added to the shared `SELECT` in `profile.ts`: one missing
 * column there would fail the WHOLE profile load.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ─────────────────────────── identity ─────────────────────────── */

export interface ProfileIdentity {
  type: ProfileTypeKey;
  landingModule: string | null;
}

/** The profile's declared TYPE and landing module (migration 0107). */
export async function getProfileIdentity(profileId: string): Promise<ProfileIdentity> {
  const fallback: ProfileIdentity = { type: DEFAULT_PROFILE_TYPE, landingModule: null };
  if (!hasSupabase) return fallback;
  try {
    const { data, error } = await createAdminClient()
      .from("profiles")
      .select("profile_type, landing_module")
      .eq("id", profileId)
      .maybeSingle();
    if (error) return fallback;
    const row = data as { profile_type: string | null; landing_module: string | null } | null;
    // `profileType` maps an unknown/legacy value back to personal, so a bad
    // string in the column can never produce a profile with no modules.
    return { type: profileType(row?.profile_type).key, landingModule: row?.landing_module ?? null };
  } catch {
    return fallback;
  }
}

/* ──────────────────────────── modules ─────────────────────────── */

/** A member's stored module preferences. Empty = they've never customised. */
export async function getProfileModules(profileId: string): Promise<StoredModule[]> {
  if (!hasSupabase) return [];
  try {
    const { data, error } = await createAdminClient()
      .from("profile_modules")
      .select("module_key, enabled, position, audience")
      .eq("user_id", profileId)
      .order("position", { ascending: true });
    if (error) return [];
    return ((data ?? []) as { module_key: string; enabled: boolean; position: number; audience: string }[]).map(
      (r) => ({
        moduleKey: r.module_key,
        enabled: r.enabled,
        position: r.position,
        // Left as a plain string: it may be a built-in key or a Part 17
        // `circle:<uuid>`. `canSeeModule` narrows it and fails closed.
        audience: r.audience ?? DEFAULT_MODULE_AUDIENCE,
      }),
    );
  } catch {
    return [];
  }
}

/* ──────────────────────────── details ─────────────────────────── */

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

/** jsonb columns are `unknown` until proven otherwise — never trust the shape. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

function hoursList(value: unknown): OpeningHours[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .map((v) => ({
      day: typeof v.day === "number" ? v.day : 0,
      open: typeof v.open === "string" ? v.open : "09:00",
      close: typeof v.close === "string" ? v.close : "17:00",
      closed: v.closed === true,
    }))
    .filter((h) => h.day >= 0 && h.day <= 6)
    .sort((a, b) => a.day - b.day);
}

export async function getProfileDetails(profileId: string): Promise<ProfileDetails> {
  if (!hasSupabase) return EMPTY_DETAILS;
  try {
    const { data, error } = await createAdminClient()
      .from("profile_details")
      .select("*")
      .eq("user_id", profileId)
      .maybeSingle();
    if (error || !data) return EMPTY_DETAILS;
    const r = data as Record<string, unknown>;
    const text = (k: string): string | null => {
      const v = r[k];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    return {
      headline: text("headline"),
      category: text("category"),
      mission: text("mission"),
      languages: stringList(r.languages),
      availability: text("availability"),
      skills: stringList(r.skills),
      resumeUrl: text("resume_url"),
      founded: text("founded"),
      teamSize: text("team_size"),
      contactEmail: text("contact_email"),
      contactPhone: text("contact_phone"),
      bookingUrl: text("booking_url"),
      quoteUrl: text("quote_url"),
      address: text("address"),
      city: text("city"),
      country: text("country"),
      hours: hoursList(r.hours),
    };
  } catch {
    return EMPTY_DETAILS;
  }
}

/* ────────────────────────── credentials ───────────────────────── */

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

export async function listCredentials(profileId: string): Promise<Credential[]> {
  if (!hasSupabase) return [];
  try {
    const { data, error } = await createAdminClient()
      .from("profile_credentials")
      .select("id, kind, title, organization, description, url, image_url, started_on, ended_on, is_current, position")
      .eq("user_id", profileId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return [];
    return ((data ?? []) as Record<string, unknown>[])
      .map((r) => ({
        id: String(r.id),
        kind: r.kind as CredentialKind,
        title: String(r.title ?? ""),
        organization: (r.organization as string | null) || null,
        description: (r.description as string | null) || null,
        url: (r.url as string | null) || null,
        imageUrl: (r.image_url as string | null) || null,
        startedOn: (r.started_on as string | null) || null,
        endedOn: (r.ended_on as string | null) || null,
        isCurrent: r.is_current === true,
        position: typeof r.position === "number" ? r.position : 0,
      }))
      .filter((c) => c.title && CREDENTIAL_MODULE[c.kind]);
  } catch {
    return [];
  }
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

export async function listOfferings(profileId: string): Promise<Offering[]> {
  if (!hasSupabase) return [];
  try {
    const { data, error } = await createAdminClient()
      .from("profile_offerings")
      .select("id, kind, name, description, price_minor, currency, url, image_url, available, position")
      .eq("user_id", profileId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return [];
    return ((data ?? []) as Record<string, unknown>[])
      .map((r) => ({
        id: String(r.id),
        kind: (r.kind === "service" ? "service" : "product") as OfferingKind,
        name: String(r.name ?? ""),
        description: (r.description as string | null) || null,
        priceMinor: typeof r.price_minor === "number" ? r.price_minor : null,
        currency: typeof r.currency === "string" && r.currency ? r.currency : "NGN",
        url: (r.url as string | null) || null,
        imageUrl: (r.image_url as string | null) || null,
        available: r.available !== false,
        position: typeof r.position === "number" ? r.position : 0,
      }))
      .filter((o) => o.name);
  } catch {
    return [];
  }
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
