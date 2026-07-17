-- Admin "hide" becomes friends-only, and stops being a synonym for "suspend".
--
-- Owner (2026-07-16): "i want user account that was hidden by admin can
-- interact, post, chat and everything, but to only people they are already
-- friends with ... the hide profile only restrict them from users they are not
-- friends with."
--
-- WHY A NEW COLUMN, when 0080-era work deliberately reused `is_suspended`:
-- reuse was right when hide and suspend meant the same thing ("invisible
-- everywhere, can't publish"). It is wrong now that they diverge. A suspension
-- is a PUNISHMENT and must stay a full lockout — an account suspended for
-- harassing people must not keep posting and chatting, and its friends are
-- usually exactly who it was harassing. A hide is a SECURITY/PRIVACY measure and
-- is explicitly not a punishment: the account keeps every ability, it just
-- can't be seen or reached by strangers. One boolean cannot carry both meanings,
-- so this splits them:
--
--   is_suspended -> full lockout. Set by the report queue's Suspend action.
--   is_hidden    -> friends-only. Set by the admin Account-visibility panel.
--
-- BACKFILL — verified, not assumed. Queried live 2026-07-16 before writing this:
-- exactly 2 of 19 profiles had is_suspended = true (@juliengozi, @priceless),
-- and `security_audit_log` holds only 4 moderation_action rows ever, all from
-- today's admin Hide panel, none from the report queue. So every currently
-- suspended account is in fact an admin HIDE, and moving it to is_hidden is a
-- faithful translation rather than a mass un-suspension. If a real report-driven
-- suspension had existed, this backfill would have to exclude it by id.
alter table public.profiles
  add column if not exists is_hidden  boolean not null default false,
  add column if not exists hidden_at  timestamptz,
  add column if not exists hidden_by  uuid;

-- Partial index: every read filters `is_hidden = false` for strangers, and the
-- hidden set is tiny, so index only the true rows.
create index if not exists profiles_is_hidden_idx
  on public.profiles (id) where is_hidden;

update public.profiles
set is_hidden    = true,
    hidden_at    = coalesce(hidden_at, now()),
    is_suspended = false
where is_suspended = true;

comment on column public.profiles.is_hidden is
  'Admin hide: the account is visible to, and reachable by, its existing friends ONLY. Not a punishment — it keeps every ability to post, comment, react and chat. Contrast is_suspended, which is a full lockout.';
