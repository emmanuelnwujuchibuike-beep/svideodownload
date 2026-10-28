-- ═══════════════════════════════════════════════════════════════════════════
--  0296 — Frenz Gift Coin: several copies of a sticker in one send, an optional note, no PIN (Part 6, 2026-10-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner decisions for Part 6:
--   · quantity: several copies of the selected sticker in ONE action, each recorded as its own gift
--   · an optional note, at most 200 characters
--   · "Users shouldn't have to enter a PIN to send a gift, they send a gift like a normal sticker" — the app asks
--     "are you sure?" instead (the member may skip that for a week). So this send is NOT behind the transaction PIN.
--     Every other protection is unchanged and still decided here: the session (the server passes the signed-in
--     member), the chat rules, blocks, the sticker revision and price the member was shown, the sender standing
--     (restrictions, recovery, held or disputed deposits, the post-deposit cooldown), the daily limit and AVAILABLE FGC.
--     send_gift_with_pin (0293) stays as it was for any caller still using it.
--
-- ── Why a migration ─────────────────────────────────────────────────────────
--   send_gift (0293) makes exactly one gift per call. Several client requests would not be atomic, so the batch is ONE
--   database function that calls the unchanged send_gift once per copy inside a single savepoint: every copy passes
--   every rule (each one sees the copies before it, so the daily limit and the balance are checked against the WHOLE
--   batch) or the savepoint is rolled back and NOTHING remains — no gift, ledger row, fee row, notification row or
--   audit row of the batch. Nothing in 0290–0294 is rewritten. This file adds columns and replaces three functions:
--   gift_sends_guard (lets the batch label its own new rows once), messages_gift_guard (a batch bubble must match its
--   batch) and claim_gift_notification (reports the batch so the dispatcher announces a batch once).
--
-- ── The batch (send_gift_batch) ─────────────────────────────────────────────
--   quantity 1 to 10 (GIFT_BATCH_MAX in lib/gift/batch.ts — a chat gesture, not a bulk tool, and it bounds how long
--   both wallets stay locked; the value cap is still the administrator's daily limit). Copy i uses the idempotency key
--   <key>-<i>, so the batch key is 8 to 76 characters. A replay of the key answers the committed batch (never charged
--   again); the same key with a different sticker, chat, recipient, quantity or note is idempotency_conflict. Two
--   identical requests at once: the second waits on the wallet locks, then finds copy 1 and answers the first batch.
--   Each copy is a full gift_sends row (its own id, snapshot, price, share, commission, hold, ledger rows, two
--   notification rows and audit row). The batch then labels its rows: batch_id, batch_index 1..n, batch_size n.
--
-- ── The note ────────────────────────────────────────────────────────────────
--   Trimmed at both ends, blank = none, at most 200 characters, no control characters (refused, nothing charged).
--   Stored ONCE, on the batch's first gift (batch_index 1) — the gift the chat bubble names. The other copies carry no
--   note and point to it through batch_id. Never placed in a ledger row, an audit row, a notification or a log.
--
-- Depends on 0293, 0294. Run by hand AFTER 0295. Safe to run twice. No semicolon inside any quoted string or comment.
-- Every dollar-quoted block is at the end.

alter table public.gift_sends add column if not exists batch_id uuid;
alter table public.gift_sends add column if not exists batch_index smallint;
alter table public.gift_sends add column if not exists batch_size smallint;
alter table public.gift_sends add column if not exists note text;
alter table public.gift_sends drop constraint if exists gift_sends_batch_chk;
alter table public.gift_sends add constraint gift_sends_batch_chk check (
  (batch_id is null and batch_index is null and batch_size is null)
  or (batch_id is not null and batch_size between 1 and 10 and batch_index between 1 and batch_size));
alter table public.gift_sends drop constraint if exists gift_sends_note_chk;
alter table public.gift_sends add constraint gift_sends_note_chk check (
  note is null or (batch_index = 1 and char_length(note) between 1 and 200 and note = btrim(note) and note !~ '[[:cntrl:]]'));
create unique index if not exists gift_sends_batch_uidx on public.gift_sends (batch_id, batch_index) where batch_id is not null;
comment on column public.gift_sends.batch_id is '0296: the send action this gift was part of (several copies in one send). Null for a gift sent alone before 0296.';
comment on column public.gift_sends.note is '0296: the sender optional note (at most 200 characters), stored on the first gift of its batch only. Never in a notification, ledger or audit row.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- 0293 guard, plus ONE more allowed write: send_gift_batch labelling a pending row it just made (batch columns, once).
create or replace function public.gift_sends_guard() returns trigger
language plpgsql as $$
declare
  v_batch text[] := array['batch_id', 'batch_index', 'batch_size', 'note'];
begin
  if tg_op = 'DELETE' then raise exception 'gift_sends rows are permanent (0293)'; end if;
  if coalesce(current_setting('frenz.gift_writer', true), '') <> 'on' then raise exception 'gift_sends is written only by the gift functions (0293)'; end if;
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('frenz.gift_batch_writer', true), '') = 'on' and old.batch_id is null and new.batch_id is not null
       and old.status = 'pending' and (to_jsonb(new) - v_batch) is not distinct from (to_jsonb(old) - v_batch) then
      return new;
    end if;
    if (to_jsonb(new) - array['status', 'released_at', 'reversed_at', 'reversed_by', 'reversal_reason']) is distinct from (to_jsonb(old) - array['status', 'released_at', 'reversed_at', 'reversed_by', 'reversal_reason']) then
      raise exception 'a gift cannot be rewritten (0293)';
    end if;
    if not (old.status = 'pending' and new.status in ('released', 'reversed')) then
      raise exception 'gift status % cannot become % (0293)', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

-- 0293 guard, plus: a gift bubble that states a quantity or a note must state its batch's own (no forged count or note).
create or replace function public.messages_gift_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_g public.gift_sends%rowtype;
begin
  if tg_op = 'UPDATE' and coalesce(old.metadata ->> 'kind', '') = 'gift' and new.metadata is distinct from old.metadata then
    raise exception 'a gift message cannot be edited (0293)';
  end if;
  if coalesce(new.metadata ->> 'kind', '') = 'gift' and (tg_op = 'INSERT' or coalesce(old.metadata ->> 'kind', '') <> 'gift') then
    if coalesce(new.metadata ->> 'giftId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'a gift message must name its gift (0293)'; end if;
    select * into v_g from public.gift_sends
     where id = (new.metadata ->> 'giftId')::uuid and sender_id = new.sender_id and conversation_id = new.conversation_id and message_client_id = new.client_id;
    if v_g.id is null then raise exception 'a gift message must match a gift of this sender in this conversation (0293)'; end if;
    if new.metadata ? 'quantity' and (new.metadata ->> 'quantity') is distinct from coalesce(v_g.batch_size, 1)::text then
      raise exception 'a gift message must state its own quantity (0296)';
    end if;
    if (new.metadata ->> 'note') is distinct from v_g.note then
      raise exception 'a gift message must carry its own note or none (0296)';
    end if;
  end if;
  return new;
end;
$$;

-- What a batch answers: the batch, and each gift in order. The note is returned to its SENDER only (the caller).
create or replace function public.gift_batch_result(p_batch uuid, p_duplicate boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'duplicate', p_duplicate, 'batch_id', p_batch, 'quantity', count(*),
           'gift_id', (array_agg(g.id order by g.batch_index))[1],
           'message_client_id', (array_agg(g.message_client_id order by g.batch_index))[1],
           'recipient_id', min(g.recipient_id::text), 'conversation_id', min(g.conversation_id::text),
           'sticker_id', min(g.sticker_id::text), 'revision', min(g.sticker_revision), 'price', min(g.price_fgc), 'total', sum(g.price_fgc),
           'sticker', (array_agg(g.sticker_snapshot order by g.batch_index))[1],
           'note', max(g.note), 'hold_until', min(g.hold_until),
           'gift_ids', jsonb_agg(g.id order by g.batch_index))
    from public.gift_sends g where g.batch_id = p_batch
$$;

-- Several copies of one sticker, one transaction (see the header). The server passes the signed-in member as p_sender.
create or replace function public.send_gift_batch(
  p_sender uuid, p_conversation uuid, p_recipient uuid, p_sticker uuid, p_expected_revision integer, p_expected_price bigint,
  p_quantity integer, p_note text, p_idempotency text, p_rules jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_note   text;
  v_ex     public.gift_sends%rowtype;
  v_batch  uuid := gen_random_uuid();
  v_out    jsonb;
  v_ids    uuid[] := '{}';
  v_after  bigint;
  v_detail text;
  i        int := 0;
begin
  if p_sender is null or p_conversation is null or p_sticker is null or p_quantity is null or p_quantity < 1 or p_quantity > 10
     or coalesce(p_idempotency, '') !~ '^[A-Za-z0-9_-]{8,76}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and (char_length(v_note) > 200 or v_note ~ '[[:cntrl:]]') then
    return jsonb_build_object('ok', false, 'reason', 'note_invalid');
  end if;

  -- a replay answers the committed batch, never charged again. A different body is a conflict.
  select * into v_ex from public.gift_sends where sender_id = p_sender and idempotency_key = p_idempotency || '-1';
  if v_ex.id is not null then
    if v_ex.batch_id is null or v_ex.batch_size <> p_quantity or v_ex.conversation_id <> p_conversation or v_ex.sticker_id <> p_sticker
       or v_ex.note is distinct from v_note or (p_recipient is not null and v_ex.recipient_id <> p_recipient) then
      return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict');
    end if;
    return public.gift_batch_result(v_ex.batch_id, true);
  end if;

  begin
    for n in 1..p_quantity loop
      i := n;
      v_out := public.send_gift(p_sender, p_conversation, p_recipient, p_sticker, p_expected_revision, p_expected_price, p_idempotency || '-' || n::text, p_rules);
      if not coalesce((v_out ->> 'ok')::boolean, false) then
        raise exception 'gift batch refused' using errcode = 'GB001', detail = v_out::text;
      end if;
      if coalesce((v_out ->> 'duplicate')::boolean, false) then
        -- an identical batch committed while this one waited on the wallet locks: answer it (nothing was made here)
        if n = 1 then raise exception 'gift batch replayed' using errcode = 'GB002', detail = v_out::text; end if;
        raise exception 'gift batch refused' using errcode = 'GB001', detail = jsonb_build_object('ok', false, 'reason', 'idempotency_conflict')::text;
      end if;
      v_ids := v_ids || (v_out ->> 'gift_id')::uuid;
      v_after := (v_out ->> 'balance_after')::bigint;
    end loop;

    perform set_config('frenz.gift_writer', 'on', true);
    perform set_config('frenz.gift_batch_writer', 'on', true);
    for n in 1..p_quantity loop
      update public.gift_sends set batch_id = v_batch, batch_index = n, batch_size = p_quantity, note = case when n = 1 then v_note end where id = v_ids[n];
    end loop;
    perform set_config('frenz.gift_batch_writer', 'off', true);
    perform set_config('frenz.gift_writer', 'off', true);
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_sender, 'gift_batch_sent', 'gift_batch', v_batch::text, 'gift-batch:' || v_batch::text,
            jsonb_build_object('quantity', p_quantity, 'gift_ids', to_jsonb(v_ids), 'conversation_id', p_conversation, 'sticker_id', p_sticker, 'has_note', v_note is not null));
  exception
    when sqlstate 'GB001' then
      -- everything this batch made is rolled back with the savepoint. The refusal names the copy it stopped at.
      get stacked diagnostics v_detail = pg_exception_detail;
      insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
      values (p_sender, 'gift_refused', 'gift_batch', null, null,
              jsonb_build_object('reason', v_detail::jsonb ->> 'reason', 'quantity', p_quantity, 'failed_at', i, 'sticker_id', p_sticker, 'conversation_id', p_conversation));
      return v_detail::jsonb || jsonb_build_object('quantity', p_quantity, 'failed_at', i);
    when sqlstate 'GB002' then
      select * into v_ex from public.gift_sends where sender_id = p_sender and idempotency_key = p_idempotency || '-1';
      if v_ex.batch_id is null or v_ex.batch_size <> p_quantity or v_ex.note is distinct from v_note then
        return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict');
      end if;
      return public.gift_batch_result(v_ex.batch_id, true);
  end;
  return public.gift_batch_result(v_batch, false) || jsonb_build_object('balance_after', v_after);
end;
$$;

-- 0294 claim, plus the gift's batch place: the dispatcher announces a batch once, on its first gift (lib/gift/gift-notify.ts).
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
  if v_g.status = 'reversed' then
    update public.gift_notifications set status = 'skipped', reason = 'reversed', finished_at = now(), updated_at = now() where gift_id = p_gift and channel = p_channel;
    return jsonb_build_object('ok', false, 'reason', 'reversed');
  end if;
  return jsonb_build_object('ok', true, 'gift_id', v_g.id, 'channel', p_channel, 'attempt', v_n.attempts, 'recipient_id', v_g.recipient_id, 'sender_id', v_g.sender_id,
                            'conversation_id', v_g.conversation_id, 'sticker_name', v_g.sticker_snapshot ->> 'name',
                            'batch_index', coalesce(v_g.batch_index, 1), 'batch_size', coalesce(v_g.batch_size, 1));
end;
$$;

do $$
begin
  revoke all on function public.send_gift_batch(uuid, uuid, uuid, uuid, integer, bigint, integer, text, text, jsonb) from public, anon, authenticated;
  grant execute on function public.send_gift_batch(uuid, uuid, uuid, uuid, integer, bigint, integer, text, text, jsonb) to service_role;
  revoke all on function public.gift_batch_result(uuid, boolean) from public, anon, authenticated;
  grant execute on function public.gift_batch_result(uuid, boolean) to service_role;
end
$$;
