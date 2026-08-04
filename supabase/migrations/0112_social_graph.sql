-- 0112_social_graph.sql
-- Feature 18 · Part 17 — Social Graph™, Circles, relationship labels and
-- trusted contacts.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ═══════════════════════════════════════════════════════════════════════════
-- It does not create a `connections` table.
--
-- The graph already exists: follows (0006), friendships + friend_requests
-- (0020), friend_favorites (0021), blocks (0006), muted_creators (0035) and
-- user_restrictions (0076). Around twenty read surfaces enforce those edges.
-- A new table restating them would be a second source of truth, and the first
-- time the two disagreed the visible symptom would be someone a member blocked
-- reappearing in their feed.
--
-- So Part 17 adds only what genuinely did not exist: a private ANNOTATION on
-- an existing edge (a label), a private GROUPING of existing edges (a circle),
-- and a record of who matters (trusted contacts). `lib/social/graph/edges.ts`
-- catalogues the real edges so the graph has a vocabulary without a second
-- store.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE PRIVACY INVARIANT, ENFORCED AT THE ROW LEVEL
-- ═══════════════════════════════════════════════════════════════════════════
-- Every table here is readable ONLY by the person who created the row. Not by
-- the person it is about. That is not a nicety:
--
--   · A label is one member's private note. "Acquaintance", "Ex", "Client" —
--     a readable label is a claim published about someone without consent.
--   · Circle membership must not be discoverable either. Learning you are in
--     someone's "Close Friends" is pleasant; learning you were moved OUT of it
--     is not, and neither is discovering you are filed under "Work".
--
-- The subject-side read is therefore absent by construction, and the policies
-- below are `for all` on `owner_id = auth.uid()` with no second policy that
-- could widen it. Server-side reads that must cross that line — the profile
-- engine asking "is this viewer in a circle this module is gated to?" — go
-- through the service-role client and return a BOOLEAN about visibility, never
-- the circle's name or membership.
--
-- Idempotent.

-- ---------------------------------------------------------------------
-- Relationship labels — one private label per (owner, subject).
-- ---------------------------------------------------------------------
create table if not exists public.relationship_labels (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references auth.users (id) on delete cascade,
  -- Either a built-in key from lib/social/graph/labels.ts ('mentor') or a
  -- member's own text. Not a CHECK constraint or an enum: the catalogue lives
  -- in TypeScript where it is unit-tested, and custom labels are the point.
  label      text not null check (char_length(label) between 1 and 24),
  note       text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, subject_id),
  constraint relationship_labels_not_self check (owner_id <> subject_id)
);

create index if not exists relationship_labels_owner_idx
  on public.relationship_labels (owner_id, updated_at desc);

alter table public.relationship_labels enable row level security;

-- Owner-only, in every direction. The subject has no policy at all.
drop policy if exists "relationship labels owner all" on public.relationship_labels;
create policy "relationship labels owner all" on public.relationship_labels
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- Social Circles — private named groups.
-- ---------------------------------------------------------------------
create table if not exists public.social_circles (
  id         uuid primary key default uuid_generate_v4(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 32),
  -- A palette KEY ('blue'), never a hex or arbitrary CSS. The circle colour is
  -- rendered into a class name and a gradient; taking a colour string from a
  -- request and interpolating it into a style attribute is CSS injection from
  -- a personalisation field. lib/social/graph/circles.ts owns the mapping.
  color      text not null default 'blue'
             check (color in ('blue','violet','emerald','amber','rose','sky','pink','slate')),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One circle per name per member, case-insensitively — otherwise "Family" and
-- "family" become two lists that each hold half the family.
create unique index if not exists social_circles_owner_name_uidx
  on public.social_circles (owner_id, lower(name));
create index if not exists social_circles_owner_idx
  on public.social_circles (owner_id, position, created_at);

alter table public.social_circles enable row level security;

drop policy if exists "social circles owner all" on public.social_circles;
create policy "social circles owner all" on public.social_circles
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- Circle membership.
--
-- `owner_id` is denormalised onto the row on purpose. Without it, the RLS
-- policy would have to sub-select social_circles on every read — the recursive
-- policy shape that took messaging down once already (see the RLS recursion
-- incident). A trigger keeps it honest, so it cannot be set to someone else.
-- ---------------------------------------------------------------------
create table if not exists public.circle_members (
  circle_id  uuid not null references public.social_circles (id) on delete cascade,
  member_id  uuid not null references auth.users (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (circle_id, member_id)
);

create index if not exists circle_members_owner_idx  on public.circle_members (owner_id, added_at desc);
-- The profile engine's question: "which of this owner's circles is the viewer in?"
create index if not exists circle_members_lookup_idx on public.circle_members (owner_id, member_id);

alter table public.circle_members enable row level security;

drop policy if exists "circle members owner all" on public.circle_members;
create policy "circle members owner all" on public.circle_members
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Stamp owner_id from the circle itself so a client cannot claim someone
-- else's circle by supplying a different owner_id.
create or replace function public.stamp_circle_member_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select c.owner_id into NEW.owner_id from public.social_circles c where c.id = NEW.circle_id;
  if NEW.owner_id is null then
    raise exception 'circle % does not exist', NEW.circle_id;
  end if;
  return NEW;
end $$;

drop trigger if exists circle_members_owner_trg on public.circle_members;
create trigger circle_members_owner_trg
  before insert or update on public.circle_members
  for each row execute function public.stamp_circle_member_owner();

-- ---------------------------------------------------------------------
-- Trusted contacts — a RECORD, not a grant.
--
-- `capability` is constrained to the two that grant nothing. Account recovery
-- and delegated access are absent from the CHECK deliberately: a half-built
-- trusted-contact recovery flow is an account-takeover path for someone who
-- knows the member personally, and the threat model for "trusted contact" has
-- to assume an abusive partner. Adding those values needs the whole
-- out-of-band challenge, waiting period, veto notification, rate limit and
-- audit trail described in lib/social/graph/trusted.ts — at which point the
-- constraint is widened in a migration of its own.
-- ---------------------------------------------------------------------
create table if not exists public.trusted_contacts (
  id         uuid primary key default uuid_generate_v4(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  contact_id uuid not null references auth.users (id) on delete cascade,
  capability text not null check (capability in ('emergency','legacy')),
  note       text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now(),
  constraint trusted_contacts_not_self check (owner_id <> contact_id)
);

create unique index if not exists trusted_contacts_uidx
  on public.trusted_contacts (owner_id, contact_id, capability);
create index if not exists trusted_contacts_owner_idx
  on public.trusted_contacts (owner_id, created_at desc);

alter table public.trusted_contacts enable row level security;

drop policy if exists "trusted contacts owner all" on public.trusted_contacts;
create policy "trusted contacts owner all" on public.trusted_contacts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- Relationship privacy — three independent controls on privacy_settings.
--
-- `friends_visibility` defaults to 'friends' rather than 'public'. A friend
-- list is a far more revealing document than a follower list — it maps a
-- member's real-world circle — and no public friends-list surface has ever
-- existed, so this is the setting's first appearance rather than a narrowing
-- of something members already rely on. Defaulting it open would have made
-- every existing account's friend list public the day this shipped.
--
-- `show_mutual_connections` is separate, and defaults TRUE, because it governs
-- something much weaker: whether a member may be COUNTED in someone else's
-- "3 friends in common". A count names nobody. The platform never names a
-- mutual (see lib/social/graph/suggestions.ts), so the aggregate stays on by
-- default while browsing the actual list does not.
-- ---------------------------------------------------------------------
alter table public.privacy_settings
  add column if not exists friends_visibility      text not null default 'friends',
  add column if not exists following_visibility    text not null default 'public',
  add column if not exists show_mutual_connections boolean not null default true;

alter table public.privacy_settings drop constraint if exists privacy_friends_chk;
alter table public.privacy_settings add constraint privacy_friends_chk
  check (friends_visibility in ('public','friends','private'));

alter table public.privacy_settings drop constraint if exists privacy_following_chk;
alter table public.privacy_settings add constraint privacy_following_chk
  check (following_visibility in ('public','followers','private'));
