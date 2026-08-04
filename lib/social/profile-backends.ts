import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The profile backends from migration 0110 — Featured, Events, Team, Reviews,
 * Membership tiers, Repositories, Personal Spaces, Widgets, Goals, Snapshots
 * and view stats.
 *
 * Every read is FAIL-CLOSED and INDEPENDENT: its own try/catch, its own empty
 * value. That is what lets 0110 sit unapplied without breaking a single page —
 * each section simply has nothing in it, which is the same state as a member who
 * hasn't filled it in, and the engine already hides empty sections from visitors.
 *
 * These are all small, owner-scoped lists read once per profile view, so each is
 * a single indexed query with a hard cap. Nothing here fans out per item.
 */

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Runs a read, returning `fallback` on ANY failure (including a missing table). */
async function safe<T>(run: () => PromiseLike<{ data: unknown; error: unknown }>, map: (rows: Record<string, unknown>[]) => T, fallback: T): Promise<T> {
  if (!hasSupabase) return fallback;
  try {
    const { data, error } = await run();
    if (error) return fallback;
    return map((data ?? []) as Record<string, unknown>[]);
  } catch {
    return fallback;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim().length > 0) : [];

/* ───────────────────────────── Featured ───────────────────────────── */

export type FeaturedKind = "post" | "product" | "service" | "credential" | "link";

export interface FeaturedItem {
  id: string;
  kind: FeaturedKind;
  refId: string | null;
  url: string | null;
  title: string | null;
  thumbnail: string | null;
  position: number;
}

export async function listFeatured(profileId: string): Promise<FeaturedItem[]> {
  return safe(
    () =>
      createAdminClient()
        .from("profile_featured")
        .select("id, ref_kind, ref_id, url, title, thumbnail, position")
        .eq("user_id", profileId)
        .order("position", { ascending: true })
        .limit(24),
    (rows) =>
      rows.map((r) => ({
        id: String(r.id),
        kind: (r.ref_kind as FeaturedKind) ?? "link",
        refId: str(r.ref_id),
        url: str(r.url),
        title: str(r.title),
        thumbnail: str(r.thumbnail),
        position: num(r.position) ?? 0,
      })),
    [],
  );
}

/* ────────────────────────────── Events ────────────────────────────── */

export interface ProfileEvent {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  url: string | null;
  coverUrl: string | null;
  rsvpCount: number;
  /** True when the event has already finished. */
  past: boolean;
}

export async function listEvents(profileId: string): Promise<ProfileEvent[]> {
  return safe(
    () =>
      createAdminClient()
        .from("profile_events")
        .select("id, title, description, starts_at, ends_at, location, url, cover_url, rsvp_count")
        .eq("user_id", profileId)
        .order("starts_at", { ascending: false })
        .limit(50),
    (rows) => {
      const now = Date.now();
      return rows.map((r) => {
        const startsAt = String(r.starts_at);
        const endsAt = str(r.ends_at);
        // "Past" is decided by the END where there is one — a day-long event
        // is not over the moment it starts.
        const finished = new Date(endsAt ?? startsAt).getTime() < now;
        return {
          id: String(r.id),
          title: String(r.title ?? ""),
          description: str(r.description),
          startsAt,
          endsAt,
          location: str(r.location),
          url: str(r.url),
          coverUrl: str(r.cover_url),
          rsvpCount: num(r.rsvp_count) ?? 0,
          past: finished,
        };
      });
    },
    [],
  );
}

/** Upcoming first (soonest), then past (most recent). What a visitor wants. */
export function orderEvents(events: ProfileEvent[]): ProfileEvent[] {
  const upcoming = events.filter((e) => !e.past).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = events.filter((e) => e.past).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return [...upcoming, ...past];
}

/* ─────────────────────────────── Team ─────────────────────────────── */

export interface TeamMember {
  id: string;
  memberId: string | null;
  name: string;
  role: string | null;
  avatarUrl: string | null;
  url: string | null;
}

export async function listTeam(profileId: string): Promise<TeamMember[]> {
  return safe(
    () =>
      createAdminClient()
        .from("profile_team_members")
        .select("id, member_id, name, role, avatar_url, url, position")
        .eq("user_id", profileId)
        .order("position", { ascending: true })
        .limit(60),
    (rows) =>
      rows.map((r) => ({
        id: String(r.id),
        memberId: str(r.member_id),
        name: String(r.name ?? ""),
        role: str(r.role),
        avatarUrl: str(r.avatar_url),
        url: str(r.url),
      })),
    [],
  );
}

/* ────────────────────────────── Reviews ───────────────────────────── */

export interface ProfileReview {
  id: string;
  authorId: string;
  rating: number;
  body: string | null;
  /** Only ever true when the review is tied to a real order. See 0110. */
  verified: boolean;
  createdAt: string;
}

export interface ReviewSummary {
  reviews: ProfileReview[];
  count: number;
  /** Mean rating to one decimal, or null when there are none. Never a default. */
  average: number | null;
}

export async function getReviews(profileId: string): Promise<ReviewSummary> {
  const reviews = await safe<ProfileReview[]>(
    () =>
      createAdminClient()
        .from("profile_reviews")
        .select("id, author_id, rating, body, verified, created_at")
        .eq("user_id", profileId)
        .eq("hidden", false)
        .order("created_at", { ascending: false })
        .limit(100),
    (rows) =>
      rows.map((r) => ({
        id: String(r.id),
        authorId: String(r.author_id),
        rating: num(r.rating) ?? 0,
        body: str(r.body),
        verified: r.verified === true,
        createdAt: String(r.created_at),
      })),
    [],
  );

  if (reviews.length === 0) return { reviews, count: 0, average: null };
  const mean = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  return { reviews, count: reviews.length, average: Math.round(mean * 10) / 10 };
}

/* ────────────────────────── Membership tiers ──────────────────────── */

export interface MembershipTier {
  id: string;
  name: string;
  description: string | null;
  priceMinor: number | null;
  currency: string;
  interval: "month" | "year";
  checkoutUrl: string | null;
  perks: string[];
}

export async function listMembershipTiers(profileId: string): Promise<MembershipTier[]> {
  return safe(
    () =>
      createAdminClient()
        .from("profile_membership_tiers")
        .select("id, name, description, price_minor, currency, interval, checkout_url, perks, position")
        .eq("user_id", profileId)
        .order("position", { ascending: true })
        .limit(12),
    (rows) =>
      rows.map((r) => ({
        id: String(r.id),
        name: String(r.name ?? ""),
        description: str(r.description),
        priceMinor: num(r.price_minor),
        currency: str(r.currency) ?? "NGN",
        interval: r.interval === "year" ? ("year" as const) : ("month" as const),
        checkoutUrl: str(r.checkout_url),
        perks: strings(r.perks),
      })),
    [],
  );
}

/* ─────────────────────────── Repositories ─────────────────────────── */

export interface Repository {
  id: string;
  name: string;
  description: string | null;
  url: string;
  language: string | null;
  stars: number | null;
}

export async function listRepositories(profileId: string): Promise<Repository[]> {
  return safe(
    () =>
      createAdminClient()
        .from("profile_repositories")
        .select("id, name, description, url, language, stars, position")
        .eq("user_id", profileId)
        .order("position", { ascending: true })
        .limit(60),
    (rows) =>
      rows
        .map((r) => ({
          id: String(r.id),
          name: String(r.name ?? ""),
          description: str(r.description),
          url: str(r.url) ?? "",
          language: str(r.language),
          stars: num(r.stars),
        }))
        .filter((r) => r.url),
    [],
  );
}

/* ───────────────────────── Personal Spaces ────────────────────────── */

export interface PersonalSpace {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  accent: string | null;
  modules: string[];
  enabled: boolean;
  position: number;
}

export async function listSpaces(profileId: string): Promise<PersonalSpace[]> {
  return safe(
    () =>
      createAdminClient()
        .from("profile_spaces")
        .select("id, slug, name, description, icon, accent, modules, enabled, position")
        .eq("user_id", profileId)
        .order("position", { ascending: true })
        .limit(20),
    (rows) =>
      rows.map((r) => ({
        id: String(r.id),
        slug: String(r.slug ?? ""),
        name: String(r.name ?? ""),
        description: str(r.description),
        icon: str(r.icon),
        accent: str(r.accent),
        modules: strings(r.modules),
        enabled: r.enabled !== false,
        position: num(r.position) ?? 0,
      })),
    [],
  );
}

/* ────────────────────────────── Widgets ───────────────────────────── */

export interface StoredWidget {
  widgetKey: string;
  enabled: boolean;
  position: number;
  audience: string;
  config: Record<string, unknown>;
}

export async function getProfileWidgets(profileId: string): Promise<StoredWidget[]> {
  return safe(
    () =>
      createAdminClient()
        .from("profile_widgets")
        .select("widget_key, enabled, position, audience, config")
        .eq("user_id", profileId)
        .order("position", { ascending: true })
        .limit(40),
    (rows) =>
      rows.map((r) => ({
        widgetKey: String(r.widget_key),
        enabled: r.enabled !== false,
        position: num(r.position) ?? 0,
        audience: str(r.audience) ?? "public",
        config: (r.config && typeof r.config === "object" ? r.config : {}) as Record<string, unknown>,
      })),
    [],
  );
}

/* ─────────────────────────────── Goals ────────────────────────────── */

export interface StoredGoal {
  id: string;
  metric: string;
  target: number;
  label: string | null;
  dueOn: string | null;
  achievedAt: string | null;
}

export async function listGoals(profileId: string): Promise<StoredGoal[]> {
  return safe(
    () =>
      createAdminClient()
        .from("profile_goals")
        .select("id, metric, target, label, due_on, achieved_at")
        .eq("user_id", profileId)
        .order("created_at", { ascending: false })
        .limit(20),
    (rows) =>
      rows.map((r) => ({
        id: String(r.id),
        metric: String(r.metric),
        target: num(r.target) ?? 0,
        label: str(r.label),
        dueOn: str(r.due_on),
        achievedAt: str(r.achieved_at),
      })),
    [],
  );
}

/* ──────────────────────── Snapshots & views ───────────────────────── */

export interface ProfileSnapshot {
  capturedOn: string;
  posts: number;
  followers: number;
  following: number;
  friends: number;
  collections: number;
  reputation: number;
  healthScore: number | null;
}

/** Oldest → newest, so a caller can plot it directly. */
export async function listSnapshots(profileId: string, days = 30): Promise<ProfileSnapshot[]> {
  const rows = await safe<ProfileSnapshot[]>(
    () =>
      createAdminClient()
        .from("profile_snapshots")
        .select("captured_on, posts, followers, following, friends, collections, reputation, health_score")
        .eq("user_id", profileId)
        .order("captured_on", { ascending: false })
        .limit(Math.max(1, Math.min(365, days))),
    (r) =>
      r.map((s) => ({
        capturedOn: String(s.captured_on),
        posts: num(s.posts) ?? 0,
        followers: num(s.followers) ?? 0,
        following: num(s.following) ?? 0,
        friends: num(s.friends) ?? 0,
        collections: num(s.collections) ?? 0,
        reputation: num(s.reputation) ?? 0,
        healthScore: num(s.health_score),
      })),
    [],
  );
  return rows.reverse();
}

export interface ViewStat {
  viewedOn: string;
  views: number;
}

export async function listViewStats(profileId: string, days = 30): Promise<ViewStat[]> {
  const rows = await safe<ViewStat[]>(
    () =>
      createAdminClient()
        .from("profile_view_stats")
        .select("viewed_on, views")
        .eq("user_id", profileId)
        .order("viewed_on", { ascending: false })
        .limit(Math.max(1, Math.min(365, days))),
    (r) => r.map((s) => ({ viewedOn: String(s.viewed_on), views: num(s.views) ?? 0 })),
    [],
  );
  return rows.reverse();
}

/**
 * Count one profile view. Fire-and-forget, and never awaited on a render path —
 * a page must not get slower because it is being counted.
 */
export async function recordProfileView(profileId: string): Promise<void> {
  if (!hasSupabase) return;
  try {
    await createAdminClient().rpc("increment_profile_view", { target: profileId });
  } catch {
    /* 0110 not applied, or a transient failure — a missed view is not an error */
  }
}
