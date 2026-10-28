-- ═══════════════════════════════════════════════════════════════════════════
--  0294 — Frenz Gift Coin: gift notifications by push and email, each with its own switch (Part 4.1, 2026-10-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── The member's two switches (notification_settings) ───────────────────────
--   gift_push   push me when I receive a sticker gift   (default true)
--   gift_email  email me when I receive a sticker gift  (default true)
--   Independent: changing one never touches the other. On by default, the policy every per-event switch here follows
--   (category_prefs defaults, 0262 message_email, 0253 optional_email). The global controls still apply on top: the
--   master / push switches, the premium category, quiet hours, delivery rules and device permissions for push, and the
--   global optional-email switch (0253) for email — a gift email is OPTIONAL email (lib/email/consent.ts gift_received).
--   The member writes them through /api/notification-settings (their own row, the server's service role). The 0046
--   policy "notification settings self all" already scopes the row to its owner.
--
-- ── The outbox (gift_notifications) ─────────────────────────────────────────
--   One row per (gift, channel), written by a trigger on gift_sends in the SAME transaction as the gift — a committed
--   gift always has its two rows, a rolled-back gift has none, and send_gift (0293) is not changed. Never written by an
--   API role. The server dispatches after the response (no provider call inside a financial transaction):
--     claim_gift_notification   pending, or failed with attempts left, or a 'sending' claim older than 15 minutes ->
--                               'sending', attempts + 1, ONE caller only (a conditional update under the row lock).
--                               A reversed gift is answered 'skipped' (reversed) and never sent.
--     finish_gift_notification  sending -> sent (the provider ACCEPTED it) | skipped (a switch or rule said no, no
--                               device, no address) | failed (refused, retried while attempts remain). Sent and
--                               skipped are final.
--     due_gift_notifications    the retry sweep's work list (the existing 10-minute reconcile cron): pending rows the
--                               after-response dispatch never reached, failed rows with attempts left, stale claims.
--   A replayed gift request finds its rows already sent: nothing is sent twice. Statuses and reasons only, no content.
--
-- Depends on 0046 (notification_settings), 0293 (gift_sends). Run by hand AFTER 0293. Safe to run twice.
-- No semicolon inside any quoted string or comment. Every dollar-quoted block is at the end.

alter table public.notification_settings add column if not exists gift_push boolean not null default true;
alter table public.notification_settings add column if not exists gift_email boolean not null default true;
comment on column public.notification_settings.gift_push is '0294: push me when I receive a sticker gift. Independent of gift_email. The global push controls still apply.';
comment on column public.notification_settings.gift_email is '0294: email me when I receive a sticker gift. Independent of gift_push. The global optional-email switch (0253) still applies.';

create table if not exists public.gift_notifications (
  gift_id       uuid not null references public.gift_sends (id),
  channel       text not null,
  recipient_id  uuid not null,
  status        text not null default 'pending',
  reason        text,
  attempts      integer not null default 0,
  claimed_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (gift_id, channel),
  constraint gift_notifications_channel_chk check (channel in ('push', 'email')),
  constraint gift_notifications_status_chk check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  constraint gift_notifications_attempts_chk check (attempts between 0 and 10),
  constraint gift_notifications_reason_chk check (reason is null or reason ~ '^[a-z_]{1,40}$')
);
create index if not exists gift_notifications_due_idx on public.gift_notifications (created_at) where status in ('pending', 'failed', 'sending');
alter table public.gift_notifications enable row level security;
revoke all on public.gift_notifications from public, anon, authenticated;
grant all on public.gift_notifications to service_role;
comment on table public.gift_notifications is 'Frenz Gift Coin (0294): the outbox of gift-received notifications, one row per gift and channel (push, email), written with the gift. Delivery status and a reason code only, no content. Service role only.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- The gift's two notification rows, in the gift's own transaction.
create or replace function public.gift_notifications_enqueue() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.gift_notifications (gift_id, channel, recipient_id) values (new.id, 'push', new.recipient_id), (new.id, 'email', new.recipient_id)
  on conflict (gift_id, channel) do nothing;
  return new;
end;
$$;

-- Claim one notification for sending. One caller wins. Answers what the sender needs: who, from whom, where, which sticker.
create or replace function public.claim_gift_notification(p_gift uuid, p_channel text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n   public.gift_notifications%rowtype;
  v_g   public.gift_sends%rowtype;
begin
  if p_gift is null or p_channel not in ('push', 'email') then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into v_g from public.gift_sends where id = p_gift;
  if v_g.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  update public.gift_notifications
     set status = 'sending', attempts = attempts + 1, claimed_at = now(), updated_at = now()
   where gift_id = p_gift and channel = p_channel
     and (status = 'pending' or (status = 'failed' and attempts < 3) or (status = 'sending' and claimed_at < now() - interval '15 minutes'))
  returning * into v_n;
  if v_n.gift_id is null then return jsonb_build_object('ok', false, 'reason', 'not_due'); end if;
  -- a gift reversed before it was announced is never announced as received
  if v_g.status = 'reversed' then
    update public.gift_notifications set status = 'skipped', reason = 'reversed', finished_at = now(), updated_at = now() where gift_id = p_gift and channel = p_channel;
    return jsonb_build_object('ok', false, 'reason', 'reversed');
  end if;
  return jsonb_build_object('ok', true, 'gift_id', v_g.id, 'channel', p_channel, 'attempt', v_n.attempts, 'recipient_id', v_g.recipient_id, 'sender_id', v_g.sender_id,
                            'conversation_id', v_g.conversation_id, 'sticker_name', v_g.sticker_snapshot ->> 'name');
end;
$$;

-- Record the outcome of a claimed send. Only a row this caller claimed ('sending') moves.
create or replace function public.finish_gift_notification(p_gift uuid, p_channel text, p_status text, p_reason text default null) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('sent', 'skipped', 'failed') then return false; end if;
  update public.gift_notifications
     set status = p_status, reason = case when p_reason ~ '^[a-z_]{1,40}$' then p_reason end, finished_at = now(), updated_at = now()
   where gift_id = p_gift and channel = p_channel and status = 'sending';
  return found;
end;
$$;

-- The retry sweep's work: notifications the after-response dispatch never reached, failures with attempts left, stale claims.
create or replace function public.due_gift_notifications(p_limit integer default 50) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('gift_id', gift_id, 'channel', channel) order by created_at), '[]'::jsonb)
    from (select gift_id, channel, created_at from public.gift_notifications
           where created_at > now() - interval '3 days'
             and ((status = 'pending' and created_at < now() - interval '2 minutes')
               or (status = 'failed' and attempts < 3)
               or (status = 'sending' and claimed_at < now() - interval '15 minutes'))
           order by created_at
           limit greatest(1, least(coalesce(p_limit, 50), 500))) d
$$;

do $$
begin
  execute 'drop trigger if exists gift_sends_notify on public.gift_sends';
  execute 'create trigger gift_sends_notify after insert on public.gift_sends for each row execute function public.gift_notifications_enqueue()';

  execute 'revoke all on function public.gift_notifications_enqueue() from public, anon, authenticated';
  execute 'revoke all on function public.claim_gift_notification(uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.claim_gift_notification(uuid, text) to service_role';
  execute 'revoke all on function public.finish_gift_notification(uuid, text, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.finish_gift_notification(uuid, text, text, text) to service_role';
  execute 'revoke all on function public.due_gift_notifications(integer) from public, anon, authenticated';
  execute 'grant execute on function public.due_gift_notifications(integer) to service_role';
end;
$$;
