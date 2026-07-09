-- =====================================================================
-- FrenzSave — session/device management. Exposes Supabase Auth's own
-- session store (auth.sessions) via SECURITY DEFINER functions so the
-- app can list a signed-in user's active devices and revoke individual
-- sessions (or "all but this one") WITHOUT building a parallel session
-- tracker. Revoking deletes the auth.sessions row (+ its refresh
-- tokens): the target device can't mint a new access token on its next
-- refresh, though its current (short-lived) access token remains valid
-- until it naturally expires — standard behavior, same as Supabase's
-- own dashboard "revoke session" action.
--
-- search_path is locked to '' and every table reference is fully
-- qualified — required hardening for SECURITY DEFINER functions so a
-- caller can't hijack resolution via a crafted search_path. Execute is
-- granted to service_role ONLY: these must only ever be called from
-- trusted server code (lib/supabase/admin.ts) after the caller has
-- already been authenticated via lib/api/authenticate.ts — the
-- functions trust p_user_id completely and do not re-check identity.
-- =====================================================================

create or replace function public.list_user_sessions(p_user_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  user_agent text
)
language sql
security definer
set search_path = ''
as $$
  select s.id, s.created_at, s.updated_at, s.user_agent
  from auth.sessions s
  where s.user_id = p_user_id
  order by s.updated_at desc nulls last, s.created_at desc;
$$;

revoke all on function public.list_user_sessions(uuid) from public;
grant execute on function public.list_user_sessions(uuid) to service_role;

create or replace function public.revoke_user_session(p_user_id uuid, p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_id uuid;
begin
  -- Ownership-scoped delete FIRST: only once we've confirmed p_session_id
  -- actually belongs to p_user_id do we touch refresh_tokens. Deleting by
  -- session_id alone (before this check) would let any caller invalidate
  -- an arbitrary user's refresh tokens just by guessing/passing their
  -- session id — this order closes that gap.
  delete from auth.sessions where id = p_session_id and user_id = p_user_id
    returning id into deleted_id;
  if deleted_id is not null then
    delete from auth.refresh_tokens where session_id = deleted_id;
  end if;
  return deleted_id is not null;
end;
$$;

revoke all on function public.revoke_user_session(uuid, uuid) from public;
grant execute on function public.revoke_user_session(uuid, uuid) to service_role;

create or replace function public.revoke_other_user_sessions(p_user_id uuid, p_keep_session_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from auth.refresh_tokens
    where session_id in (
      select id from auth.sessions where user_id = p_user_id and id <> p_keep_session_id
    );
  delete from auth.sessions where user_id = p_user_id and id <> p_keep_session_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.revoke_other_user_sessions(uuid, uuid) from public;
grant execute on function public.revoke_other_user_sessions(uuid, uuid) to service_role;
