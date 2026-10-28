-- ═══════════════════════════════════════════════════════════════════════════
--  0298 — every member has a wallet number, from the moment the account exists (2026-10-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "some accounts are showing wallet number not assigned … I want every user to have an account number, as they
-- create an account."
--
-- Wallet numbers were made LAZILY (0193 ensure_wallet_number: "made once on first need") — only when a member opened
-- the credits transfer screen — so a member who never had, saw "Not assigned yet" in the Frenz Coin wallet. Now:
--   · a trigger gives every NEW account its number in the same transaction that creates it
--   · every EXISTING account without one is given one below
-- Both use the unchanged ensure_wallet_number (random 10 digits, first digit 1-9, unique, retried on a collision), so
-- nothing about how a number looks, is shared or is looked up changes. Idempotent: an account that already has its
-- number keeps it. A failure to number one account never blocks its sign-up (the wallet read assigns it later).
--
-- Depends on 0193. Safe to run twice. No semicolon inside any quoted string or comment. Dollar-quoted blocks last.

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.wallet_number_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.ensure_wallet_number(new.id);
  exception when others then
    -- never in the way of creating the account: the member's own wallet read assigns it later
    null;
  end;
  return new;
end;
$$;

do $$
declare
  r record;
begin
  execute 'drop trigger if exists on_auth_user_wallet_number on auth.users';
  execute 'create trigger on_auth_user_wallet_number after insert on auth.users for each row execute function public.wallet_number_on_signup()';
  -- the backfill: every existing account without a number
  for r in select u.id from auth.users u where not exists (select 1 from public.wallet_accounts w where w.user_id = u.id) loop
    perform public.ensure_wallet_number(r.id);
  end loop;
end
$$;
