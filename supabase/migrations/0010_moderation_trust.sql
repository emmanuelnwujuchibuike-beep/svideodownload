-- =====================================================================
-- FrenzSave — Phase 10 (content P4): moderation + trust
-- One report per reporter per target (anti-brigade), auto-hide a target once a
-- threshold of DISTINCT reporters is reached, and an admin-tunable-free trust
-- score recompute. Trust gates publishing/commenting (already wired) and
-- shadow-discounts low-trust creators out of the feed (see lib/social/feed.ts).
-- Idempotent.
-- =====================================================================

-- One report per (reporter, target) so a single user can't inflate the count.
create unique index if not exists reports_unique_reporter_idx
  on public.reports (reporter_id, target_type, target_id);

-- ---------------------------------------------------------------------
-- Auto-moderation: once N DISTINCT open reports hit a target, hide it for
-- review (posts → under_review, comments → hidden). Admins restore/remove from
-- the moderation queue. Threshold kept conservative.
-- ---------------------------------------------------------------------
create or replace function public.auto_moderate_on_report()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  threshold constant int := 3;
  open_count int;
begin
  select count(*) into open_count
  from public.reports
  where target_type = NEW.target_type and target_id = NEW.target_id and status = 'open';

  if open_count >= threshold then
    if NEW.target_type = 'post' then
      update public.posts set status = 'under_review'
      where id = NEW.target_id and status = 'published';
    elsif NEW.target_type = 'comment' then
      update public.post_comments set status = 'hidden'
      where id = NEW.target_id and status = 'visible';
    end if;
  end if;
  return null;
end $$;

drop trigger if exists reports_auto_moderate_trg on public.reports;
create trigger reports_auto_moderate_trg
  after insert on public.reports
  for each row execute function public.auto_moderate_on_report();

-- ---------------------------------------------------------------------
-- Trust score recompute. 0..100 from account age, followers, published posts,
-- minus upheld (actioned) user reports. Suspended accounts are skipped (their
-- low score stands). Run by the maintenance cron.
-- ---------------------------------------------------------------------
create or replace function public.recompute_trust_scores()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.profiles p set trust_score = greatest(0, least(100,
      least(20, floor(extract(epoch from (now() - p.created_at)) / 86400.0)::int) -- +1/day up to 20
    + least(30, p.followers_count)                                                -- up to 30
    + least(25, coalesce((select count(*) from public.posts po
        where po.publisher_id = p.id and po.status = 'published'), 0))            -- up to 25
    - 15 * coalesce((select count(*) from public.reports r
        where r.target_type = 'user' and r.target_id = p.id and r.status = 'actioned'), 0)
  ))
  where not p.is_suspended;
  get diagnostics n = row_count;
  return n;
end $$;
