-- Living Content Platform — EDITORIAL WORKFLOW (RFC §CONTENT_WORKFLOWS, Phase 4b).
--
-- Completes the authoring plane started in 0085. Implements the full specified
-- pipeline rather than the single approve/reject gate 0085 shipped:
--
--   draft → review → technical → accessibility → SEO → legal → approved
--         → published → monitoring → iteration
--
-- Design note, because it matters for whether this gets used: the stages are DATA,
-- not an enum baked into a state machine. A workflow is a row, its stages are rows,
-- and a content item references a workflow. That means a single operator can run a
-- two-stage workflow while a regulated piece of content runs the full seven, without
-- a migration or a code change — which is the only way a pipeline this long survives
-- contact with a small team. A hardcoded seven-step enum would be abandoned.
--
-- Nothing here is read at request time. Same rule as 0085: the authoring plane is
-- editorial infrastructure; the render plane reads compiled TS.

-- ---------------------------------------------------------------------------
-- Workflow definitions
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_workflows (
  id          uuid primary key default uuid_generate_v4(),
  slug        text not null unique,
  name        text not null,
  description text,
  -- Applies to these content kinds; empty means "any".
  kinds       text[] not null default '{}',
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Exactly one default workflow, enforced by a partial unique index rather than a
-- trigger — cheaper, and it cannot be bypassed by a direct write.
create unique index if not exists editorial_workflows_one_default_idx
  on public.editorial_workflows ((true)) where is_default;

create table if not exists public.workflow_stages (
  id            uuid primary key default uuid_generate_v4(),
  workflow_id   uuid not null references public.editorial_workflows (id) on delete cascade,
  -- draft | review | technical | accessibility | seo | legal | approval | publish
  kind          text not null,
  name          text not null,
  position      integer not null,
  -- A stage that must pass before the next begins. A non-blocking stage can be
  -- worked in parallel — this is what keeps a seven-stage pipeline from serialising
  -- into seven sequential waits for one person.
  blocking      boolean not null default true,
  -- Optional automated gate: 'axe' (a11y), 'ledger' (Reality Ledger), 'links'.
  auto_check    text,
  created_at    timestamptz not null default now(),

  constraint workflow_stages_kind_chk check (kind in
    ('draft','review','technical','accessibility','seo','legal','approval','publish'))
);

create unique index if not exists workflow_stages_position_idx
  on public.workflow_stages (workflow_id, position);

-- ---------------------------------------------------------------------------
-- Per-item progress through a workflow
-- ---------------------------------------------------------------------------

create table if not exists public.content_workflow_runs (
  id           uuid primary key default uuid_generate_v4(),
  version_id   uuid not null references public.content_versions (id) on delete cascade,
  workflow_id  uuid not null references public.editorial_workflows (id),
  -- open | approved | rejected | abandoned
  status       text not null default 'open',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,

  constraint content_workflow_runs_status_chk
    check (status in ('open','approved','rejected','abandoned'))
);

-- One live run per version. A second concurrent run would let the same content be
-- approved down two different paths.
create unique index if not exists content_workflow_runs_one_open_idx
  on public.content_workflow_runs (version_id) where status = 'open';

create table if not exists public.stage_results (
  id         uuid primary key default uuid_generate_v4(),
  run_id     uuid not null references public.content_workflow_runs (id) on delete cascade,
  stage_id   uuid not null references public.workflow_stages (id),
  -- pending | passed | failed | skipped
  status     text not null default 'pending',
  -- Populated by auto_check stages; free-form per checker.
  detail     jsonb not null default '{}'::jsonb,
  actor_id   uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),

  constraint stage_results_status_chk check (status in ('pending','passed','failed','skipped')),
  -- A decided stage must record who and when — same reasoning as
  -- content_versions_approval_chk in 0085: an anonymous pass is not a review.
  constraint stage_results_decided_chk
    check (status = 'pending' or decided_at is not null)
);

create unique index if not exists stage_results_unique_idx on public.stage_results (run_id, stage_id);
create index if not exists stage_results_run_idx on public.stage_results (run_id);

-- ---------------------------------------------------------------------------
-- Review conversation
-- ---------------------------------------------------------------------------

create table if not exists public.editorial_comments (
  id         uuid primary key default uuid_generate_v4(),
  version_id uuid not null references public.content_versions (id) on delete cascade,
  stage_id   uuid references public.workflow_stages (id) on delete set null,
  author_id  uuid references auth.users (id) on delete set null,
  body       text not null,
  -- Anchor into the document, e.g. "capabilities[2].description". Null = general.
  anchor     text,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists editorial_comments_version_idx on public.editorial_comments (version_id);
create index if not exists editorial_comments_open_idx
  on public.editorial_comments (version_id) where not resolved;

-- ---------------------------------------------------------------------------
-- Publication + scheduling
-- ---------------------------------------------------------------------------

create table if not exists public.publications (
  id           uuid primary key default uuid_generate_v4(),
  item_id      uuid not null references public.content_items (id) on delete cascade,
  version_id   uuid not null references public.content_versions (id) on delete cascade,
  locale       text not null default 'en',
  published_at timestamptz not null default now(),
  -- The compile run that actually shipped it. Null until compiled — which is the
  -- honest state: approving content does not put it on the site (RFC §1).
  compile_run  uuid references public.compile_runs (id) on delete set null,
  unpublished_at timestamptz
);

create index if not exists publications_item_idx on public.publications (item_id, locale);
create unique index if not exists publications_live_idx
  on public.publications (item_id, locale) where unpublished_at is null;

create table if not exists public.content_schedules (
  id         uuid primary key default uuid_generate_v4(),
  version_id uuid not null references public.content_versions (id) on delete cascade,
  publish_at timestamptz not null,
  -- pending | done | cancelled
  status     text not null default 'pending',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint content_schedules_status_chk check (status in ('pending','done','cancelled'))
);

create index if not exists content_schedules_due_idx
  on public.content_schedules (publish_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Localization
-- ---------------------------------------------------------------------------

create table if not exists public.locales (
  code       text primary key,
  name       text not null,
  -- Right-to-left, so the renderer can set dir= without a hardcoded list.
  rtl        boolean not null default false,
  enabled    boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.locales (code, name, rtl, enabled) values
  ('en', 'English', false, true)
on conflict (code) do nothing;

create table if not exists public.translations (
  id            uuid primary key default uuid_generate_v4(),
  item_id       uuid not null references public.content_items (id) on delete cascade,
  locale        text not null references public.locales (code),
  -- The source version this was translated FROM. When the source moves ahead, the
  -- translation is stale — this column is what makes that detectable instead of
  -- silently serving an old claim in another language.
  source_version uuid not null references public.content_versions (id) on delete cascade,
  body          jsonb not null default '{}'::jsonb,
  -- missing | machine | reviewed | approved
  status        text not null default 'missing',
  translated_by text,
  updated_at    timestamptz not null default now(),

  constraint translations_status_chk check (status in ('missing','machine','reviewed','approved'))
);

create unique index if not exists translations_unique_idx on public.translations (item_id, locale);
create index if not exists translations_status_idx on public.translations (locale, status);

-- ---------------------------------------------------------------------------
-- Media registry
-- ---------------------------------------------------------------------------

create table if not exists public.media_assets (
  id           uuid primary key default uuid_generate_v4(),
  kind         text not null default 'image',
  url          text not null,
  alt          text,
  width        integer,
  height       integer,
  bytes        bigint,
  -- Perceptual hash. Screenshots are only replaced when this moves beyond a
  -- threshold — otherwise every UI tweak commits binary churn, and this project
  -- has already hit a 5GB egress cap once (RFC §6).
  phash        text,
  created_at   timestamptz not null default now()
);

create index if not exists media_assets_phash_idx on public.media_assets (phash);

create table if not exists public.asset_usage (
  id         uuid primary key default uuid_generate_v4(),
  asset_id   uuid not null references public.media_assets (id) on delete cascade,
  item_id    uuid references public.content_items (id) on delete cascade,
  -- Graph node this asset illustrates, when not tied to a content item.
  node_id    text,
  created_at timestamptz not null default now()
);

create unique index if not exists asset_usage_unique_idx
  on public.asset_usage (asset_id, coalesce(item_id::text, ''), coalesce(node_id, ''));

-- ---------------------------------------------------------------------------
-- Sync findings + link health (the Experience Sync Engine's persistence)
-- ---------------------------------------------------------------------------

create table if not exists public.sync_findings (
  id          text primary key,
  -- factual-break | stale | cosmetic
  severity    text not null,
  node_id     text not null,
  summary     text not null,
  remedy      text,
  -- open | acknowledged | resolved | wontfix
  status      text not null default 'open',
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  resolved_at timestamptz,

  constraint sync_findings_severity_chk check (severity in ('factual-break','stale','cosmetic')),
  constraint sync_findings_status_chk check (status in ('open','acknowledged','resolved','wontfix'))
);

create index if not exists sync_findings_open_idx
  on public.sync_findings (severity, last_seen desc) where status = 'open';

create table if not exists public.link_health (
  id          uuid primary key default uuid_generate_v4(),
  url         text not null,
  from_node   text,
  status_code integer,
  ok          boolean not null default true,
  checked_at  timestamptz not null default now()
);

create unique index if not exists link_health_url_idx on public.link_health (url);
create index if not exists link_health_broken_idx on public.link_health (checked_at desc) where not ok;

-- ---------------------------------------------------------------------------
-- RLS — admin-only, matching 0085.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'editorial_workflows','workflow_stages','content_workflow_runs','stage_results',
    'editorial_comments','publications','content_schedules','locales','translations',
    'media_assets','asset_usage','sync_findings','link_health'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_admin_all'
    ) then
      execute format(
        'create policy %I on public.%I for all using (public.is_admin()) with check (public.is_admin())',
        t || '_admin_all', t
      );
    end if;
  end loop;
end $$;

drop trigger if exists translations_touch on public.translations;
create trigger translations_touch
  before update on public.translations
  for each row execute function public.touch_content_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: the default workflow.
-- ---------------------------------------------------------------------------
--
-- Seeded as the full specified pipeline, with the automated stages wired to real
-- checkers and marked non-blocking where they can run in parallel. A single
-- operator can disable stages by deleting rows; nothing in code assumes seven.

insert into public.editorial_workflows (slug, name, description, is_default)
values ('standard', 'Standard editorial', 'Draft through publication with automated technical, a11y and SEO gates.', true)
on conflict (slug) do nothing;

insert into public.workflow_stages (workflow_id, kind, name, position, blocking, auto_check)
select w.id, v.kind, v.name, v.position, v.blocking, v.auto_check
from public.editorial_workflows w
cross join (values
  ('draft',         'Draft',                1, true,  null),
  ('review',        'Editorial review',     2, true,  null),
  ('technical',     'Technical validation', 3, true,  'ledger'),
  ('accessibility', 'Accessibility',        4, true,  'axe'),
  ('seo',           'SEO validation',       5, false, 'links'),
  ('legal',         'Legal / compliance',   6, false, null),
  ('approval',      'Approval',             7, true,  null),
  ('publish',       'Publish',              8, true,  null)
) as v(kind, name, position, blocking, auto_check)
where w.slug = 'standard'
  and not exists (select 1 from public.workflow_stages s where s.workflow_id = w.id);
