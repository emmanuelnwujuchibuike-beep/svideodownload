-- Living Content Platform — the AUTHORING PLANE (RFC Phase 4).
--
-- Read docs/LIVING_CONTENT_PLATFORM_RFC.md §1 before changing anything here.
--
-- The single most important property of this schema: NOTHING in it is read at
-- request time. Marketing pages never query these tables. Content is authored and
-- approved here, then COMPILED into typed TS modules (config/generated/*.ts) that
-- Next renders statically. Publishing is a build, not a write.
--
-- That is deliberate. A CMS that request-reads Postgres would put a ~290ms round
-- trip in front of every marketing page and un-static `/` (commit e7f25c6), which
-- spends the 2-second cold-entry budget that outranks features on this project.
-- Compiling instead buys type-checked content, a git-diffable audit trail, offline
-- support via the existing PWA precache, and 0ms request cost.
--
-- Consequence worth stating plainly: writing to these tables changes NOTHING on the
-- live site until `npm run content:compile` runs and the result is deployed. If you
-- ever find yourself adding a `select` against these tables from a page component,
-- the architecture has been misunderstood.
--
-- Scope note: the RFC sketched a full draft → review → technical → a11y → SEO →
-- legal → approval pipeline. That is deliberately NOT built. This platform has a
-- single operator; a seven-stage approval chain with one person in every seat is
-- ceremony, not governance. What survives is the part that actually protects the
-- site: an explicit approved/not-approved gate the compiler refuses to cross, plus
-- an append-only audit trail. Add stages when there are people to fill them.

-- ---------------------------------------------------------------------------
-- Content items — the authored unit. One row per addressable piece of content.
-- ---------------------------------------------------------------------------

create table if not exists public.content_items (
  id           uuid primary key default uuid_generate_v4(),
  -- Stable, human-readable key used by the compiler as the TS export name and by
  -- the Experience Graph as a node id. Never reuse or rename: graph edges and
  -- published URLs both point at it.
  slug         text not null unique,
  -- Mirrors lib/content/graph/types.ts → NodeKind. Kept as text (not an enum) so
  -- adding a content type does not require a migration; the compiler validates it
  -- against the TS union, which is the real source of truth for the shape.
  kind         text not null,
  title        text not null,
  -- Owning product, when the content belongs to one. Matches PlatformModule.id.
  product_id   text,
  locale       text not null default 'en',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists content_items_kind_idx    on public.content_items (kind);
create index if not exists content_items_product_idx on public.content_items (product_id);
create index if not exists content_items_locale_idx  on public.content_items (locale);

-- ---------------------------------------------------------------------------
-- Content versions — every edit, with the approval gate the compiler reads.
-- ---------------------------------------------------------------------------
--
-- Body is split into its own column set rather than a joined table because the
-- access pattern is "fetch one version whole"; the RFC's content_bodies split was
-- premature for a corpus this size and would cost a join on every compile.

create table if not exists public.content_versions (
  id            uuid primary key default uuid_generate_v4(),
  item_id       uuid not null references public.content_items (id) on delete cascade,
  -- Monotonic per item. Enforced by the unique index below, not by a sequence,
  -- so concurrent edits collide loudly instead of silently interleaving.
  version       integer not null,
  -- The payload. Shape depends on `content_items.kind` and is validated by the
  -- compiler against the corresponding TS type before anything is emitted.
  body          jsonb not null default '{}'::jsonb,
  -- draft | approved | archived. The compiler reads ONLY 'approved'.
  status        text not null default 'draft',
  -- Provenance. Set when a model drafted this version, null when a human wrote it.
  -- Non-null here does NOT bypass approval — generated content is still gated.
  generated_by  text,
  model         text,
  author_id     uuid references auth.users (id) on delete set null,
  approved_by   uuid references auth.users (id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),

  constraint content_versions_status_chk
    check (status in ('draft', 'approved', 'archived')),
  -- An approved row must record WHO approved it and WHEN. Without this an
  -- "approved" version with a null approver is indistinguishable from one that
  -- skipped review entirely, which defeats the only gate this schema has.
  constraint content_versions_approval_chk
    check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create unique index if not exists content_versions_item_version_idx
  on public.content_versions (item_id, version);

-- Partial index: the compiler's hot query is "latest approved version per item".
create index if not exists content_versions_approved_idx
  on public.content_versions (item_id, version desc)
  where status = 'approved';

-- ---------------------------------------------------------------------------
-- Product genome authoring — the DB mirror of lib/content/genome/registry.ts.
-- ---------------------------------------------------------------------------
--
-- Stored as one jsonb document per product rather than shredded across a dozen
-- relational tables. The genome is read and written WHOLE, is versioned as a unit,
-- and its shape is already pinned by ProductGenome in TS. Shredding it would buy
-- query flexibility nobody needs and cost a 12-way join on every compile, plus a
-- migration every time a field is added.

create table if not exists public.product_genomes (
  -- Matches PlatformModule.id.
  product_id   text primary key,
  genome       jsonb not null,
  -- Mirrors ProductVeracity. Denormalized out of the document so the truth gate is
  -- queryable and indexable without parsing jsonb — this is the field an admin
  -- "what may we claim?" view filters on.
  stage        text not null,
  claimable    boolean not null default false,
  verified_at  date,
  updated_at   timestamptz not null default now(),

  constraint product_genomes_stage_chk
    check (stage in ('live', 'beta', 'alpha', 'internal', 'planned', 'concept')),
  -- The Reality Ledger, enforced in the database as well as in CI. A product may
  -- not be marketable while staged as unbuilt — the two registries disagreeing is
  -- exactly how "Smart" ended up marked beta with nothing mounted.
  constraint product_genomes_claimable_chk
    check (not claimable or stage in ('live', 'beta', 'alpha'))
);

create index if not exists product_genomes_claimable_idx
  on public.product_genomes (claimable) where claimable;

-- ---------------------------------------------------------------------------
-- Authored graph edges — human assertions only.
-- ---------------------------------------------------------------------------
--
-- DERIVED edges are never stored. They are recomputed by lib/content/graph/build.ts
-- on every build, are cheap, and would go stale the moment their inputs changed.
-- Persisting them would also make it impossible to tell a human assertion from a
-- machine guess after the fact, which is the distinction the graph is built on.

create table if not exists public.graph_edges (
  id         uuid primary key default uuid_generate_v4(),
  from_id    text not null,
  to_id      text not null,
  kind       text not null,
  weight     real,
  note       text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists graph_edges_unique_idx
  on public.graph_edges (from_id, to_id, kind);
create index if not exists graph_edges_from_idx on public.graph_edges (from_id);
create index if not exists graph_edges_to_idx   on public.graph_edges (to_id);

-- A self-edge is always a mistake and breaks traversal termination.
alter table public.graph_edges
  drop constraint if exists graph_edges_no_self;
alter table public.graph_edges
  add constraint graph_edges_no_self check (from_id <> to_id);

-- ---------------------------------------------------------------------------
-- Compile runs — what was published, from what, by whom.
-- ---------------------------------------------------------------------------

create table if not exists public.compile_runs (
  id           uuid primary key default uuid_generate_v4(),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  -- ok | failed
  status       text not null default 'ok',
  items        integer not null default 0,
  -- Digest of the emitted output. Two runs over unchanged content must produce the
  -- same digest; a change here with no authoring change means the compiler is
  -- non-deterministic, which would make every build a spurious diff.
  digest       text,
  error        text,
  run_by       uuid references auth.users (id) on delete set null,

  constraint compile_runs_status_chk check (status in ('ok', 'failed'))
);

create index if not exists compile_runs_started_idx on public.compile_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Audit — append-only.
-- ---------------------------------------------------------------------------

create table if not exists public.content_audit_log (
  id         uuid primary key default uuid_generate_v4(),
  actor_id   uuid references auth.users (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_audit_entity_idx  on public.content_audit_log (entity, entity_id);
create index if not exists content_audit_created_idx on public.content_audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- RLS. Every table is admin-only: this is an internal authoring plane, and no
-- visitor-facing code path reads it (see the header note).
-- ---------------------------------------------------------------------------

alter table public.content_items     enable row level security;
alter table public.content_versions  enable row level security;
alter table public.product_genomes   enable row level security;
alter table public.graph_edges       enable row level security;
alter table public.compile_runs      enable row level security;
alter table public.content_audit_log enable row level security;

-- Admin identity matches the existing convention: the app resolves admins from
-- ADMIN_EMAILS, and server-side compile/seed work runs under the service role,
-- which bypasses RLS. These policies therefore exist to DENY everyone else —
-- there is intentionally no policy granting access to ordinary users.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'content_items' and policyname = 'content_items_admin_all'
  ) then
    create policy content_items_admin_all on public.content_items
      for all using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'content_versions' and policyname = 'content_versions_admin_all'
  ) then
    create policy content_versions_admin_all on public.content_versions
      for all using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'product_genomes' and policyname = 'product_genomes_admin_all'
  ) then
    create policy product_genomes_admin_all on public.product_genomes
      for all using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'graph_edges' and policyname = 'graph_edges_admin_all'
  ) then
    create policy graph_edges_admin_all on public.graph_edges
      for all using (public.is_admin()) with check (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'compile_runs' and policyname = 'compile_runs_admin_read'
  ) then
    create policy compile_runs_admin_read on public.compile_runs
      for select using (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'content_audit_log' and policyname = 'content_audit_admin_read'
  ) then
    -- SELECT only, and no update/delete policy anywhere: the audit trail is
    -- append-only by the absence of any grant that could rewrite it.
    create policy content_audit_admin_read on public.content_audit_log
      for select using (public.is_admin());
  end if;
end $$;

-- updated_at maintenance, matching the pattern used elsewhere in this schema.
create or replace function public.touch_content_updated_at()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  return NEW;
end $$;

drop trigger if exists content_items_touch on public.content_items;
create trigger content_items_touch
  before update on public.content_items
  for each row execute function public.touch_content_updated_at();

drop trigger if exists product_genomes_touch on public.product_genomes;
create trigger product_genomes_touch
  before update on public.product_genomes
  for each row execute function public.touch_content_updated_at();
