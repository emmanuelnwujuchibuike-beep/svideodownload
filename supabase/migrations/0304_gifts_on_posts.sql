-- ═══════════════════════════════════════════════════════════════════════════
--  0304 — Frenz Gift Coin: a gift sent on a post lives on the post, not in a chat (2026-10-28)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-28: "make gift sent from comment to show in comment not chat, and gift sent in chat to show in chat",
-- and "gifting doesn't work" (the sheet answered "You can't send gifts to this person" — a gift from a post went into
-- the 1:1 chat with the creator, so the creator's MESSAGE setting decided it: a member who doesn't follow them, or isn't
-- followed by them, could not open that chat, so could not gift their post at all).
--
-- ── What changes ────────────────────────────────────────────────────────────
--   gift_sends gains post_id (a feed post, public.posts) and sub_post_id (an exclusive post, public.sub_posts). A gift
--   now has exactly ONE place: a conversation (as before), a post, or an exclusive post (gift_sends_place_chk).
--   sub_post_comments gains gift_id: the comment row that shows an exclusive-post gift. A feed post's gift comment is a
--   post_comments row whose sticker is 'gf:<gift id>' (the column already holds 'vs:<uuid>' video stickers, 0303), so
--   post_comments does not change. Both comment rows are written by the server AFTER the gift, from the gift's own row
--   (lib/gift/gifts-server.ts) — the comment API refuses a 'gf:' sticker from a member, so no gift card can be forged.
--
-- ── How (nothing about the money changes) ──────────────────────────────────
--   send_gift and send_gift_batch are restated with ONE difference each: a null conversation is allowed when the
--   transaction-local setting frenz.gift_place names a post ('post:<uuid>') or an exclusive post ('sub_post:<uuid>').
--   Only send_place_gift_batch (new, service role only) sets it, and send_gift / send_gift_batch stay callable by no
--   API role but the service role (send_gift by none at all). The place's rules: a PUBLISHED post (or an exclusive post
--   that isn't archived), the recipient is its creator, never the sender. Every other rule is send_gift's own, unchanged
--   and in the same order: blocks, a suspended recipient, the sticker revision and price, the sender standing, the daily
--   limit, available FGC, the hold, the commission, the ledger rows, the notification rows and the audit row.
--   Who may SEE an exclusive post (an active subscriber, or its creator) is checked by the server before this is called.
--   The idempotency comparisons now use IS DISTINCT FROM, so a null conversation compares correctly.
--
-- Depends on 0293, 0294, 0296. Run by hand AFTER 0303. Safe to run twice. No semicolon inside any quoted string or
-- comment. Every dollar-quoted block is at the end.

alter table public.gift_sends alter column conversation_id drop not null;
alter table public.gift_sends add column if not exists post_id uuid;
alter table public.gift_sends add column if not exists sub_post_id uuid;
alter table public.gift_sends drop constraint if exists gift_sends_place_chk;
alter table public.gift_sends add constraint gift_sends_place_chk check (
  (conversation_id is not null)::int + (post_id is not null)::int + (sub_post_id is not null)::int = 1);
create index if not exists gift_sends_post_idx on public.gift_sends (post_id, created_at desc) where post_id is not null;
create index if not exists gift_sends_sub_post_idx on public.gift_sends (sub_post_id, created_at desc) where sub_post_id is not null;
comment on column public.gift_sends.post_id is '0304: the feed post this gift was sent on (shown in its comments). Exactly one of conversation_id, post_id, sub_post_id.';
comment on column public.gift_sends.sub_post_id is '0304: the exclusive post this gift was sent on (shown in its comments). Exactly one of conversation_id, post_id, sub_post_id.';

alter table public.sub_post_comments add column if not exists gift_id uuid;
create unique index if not exists sub_post_comments_gift_uidx on public.sub_post_comments (gift_id) where gift_id is not null;
comment on column public.sub_post_comments.gift_id is '0304: set on the comment that shows a sticker gift sent on this exclusive post. Written only by the server, from the gift row.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- 0293 send_gift, restated. ONLY the place section and the idempotency comparisons differ (see the header).
create or replace function public.send_gift(p_sender uuid, p_conversation uuid, p_recipient uuid, p_sticker uuid, p_expected_revision integer, p_expected_price bigint, p_idempotency text, p_rules jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ex      public.gift_sends%rowtype;
  v_err     text;
  v_conv    record;
  v_role    text;
  v_to      uuid := p_recipient;
  v_st      public.gift_stickers%rowtype;
  v_share   bigint;
  v_fee     bigint;
  v_bp      int;
  v_block   text;
  v_sum     bigint;
  v_bal     bigint;
  v_pend    bigint;
  v_id      uuid;
  v_s_after bigint;
  v_r_after bigint;
  v_sent    uuid;
  v_fee_row uuid;
  v_earn    uuid;
  v_hold    int;
  v_snap    jsonb;
  v_place   text := case when p_conversation is null then nullif(current_setting('frenz.gift_place', true), '') end;
  v_post    uuid;
  v_sub     uuid;
begin
  if p_sender is null or p_sticker is null or p_expected_revision is null or p_expected_price is null
     or coalesce(p_idempotency, '') !~ '^[A-Za-z0-9_-]{8,80}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_conversation is null then
    if v_place ~ '^post:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_post := substr(v_place, 6)::uuid;
    elsif v_place ~ '^sub_post:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_sub := substr(v_place, 10)::uuid;
    else return jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;
  end if;
  -- a replay answers what the first request did, and is never charged again. A different body is a conflict.
  select * into v_ex from public.gift_sends where sender_id = p_sender and idempotency_key = p_idempotency;
  if v_ex.id is not null then
    if v_ex.conversation_id is distinct from p_conversation or v_ex.post_id is distinct from v_post or v_ex.sub_post_id is distinct from v_sub
       or v_ex.sticker_id <> p_sticker or (p_recipient is not null and v_ex.recipient_id <> p_recipient) then
      return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict');
    end if;
    return public.gift_send_result(v_ex, true);
  end if;
  v_err := public.gift_rules_check(p_rules);
  if v_err = 'gifting_missing' then return jsonb_build_object('ok', false, 'reason', 'gifting_not_configured'); end if;
  if v_err is not null then return jsonb_build_object('ok', false, 'reason', 'gifting_invalid', 'detail', v_err); end if;

  if v_post is not null then
    -- a feed post: published, and the gift goes to its creator
    select publisher_id into v_to from public.posts where id = v_post and status = 'published';
    if v_to is null then return jsonb_build_object('ok', false, 'reason', 'post_unavailable'); end if;
    if p_recipient is not null and p_recipient <> v_to then return jsonb_build_object('ok', false, 'reason', 'recipient_invalid'); end if;
  elsif v_sub is not null then
    -- an exclusive post: not archived, and the gift goes to its creator (who may see it is checked by the server)
    select creator_id into v_to from public.sub_posts where id = v_sub and coalesce(status, 'published') <> 'archived';
    if v_to is null then return jsonb_build_object('ok', false, 'reason', 'post_unavailable'); end if;
    if p_recipient is not null and p_recipient <> v_to then return jsonb_build_object('ok', false, 'reason', 'recipient_invalid'); end if;
  else
    -- the conversation, by the chat's own rules
    select id, type, user_low, user_high, only_admins_can_send into v_conv from public.conversations where id = p_conversation;
    if v_conv.id is null then return jsonb_build_object('ok', false, 'reason', 'conversation_unavailable'); end if;
    if v_conv.type = 'secret' then return jsonb_build_object('ok', false, 'reason', 'secret_chat'); end if;
    select role into v_role from public.conversation_members where conversation_id = p_conversation and user_id = p_sender and left_at is null;
    if v_role is null then return jsonb_build_object('ok', false, 'reason', 'conversation_unavailable'); end if;
    if v_conv.type = 'group' then
      if coalesce(v_conv.only_admins_can_send, false) and v_role = 'member' then return jsonb_build_object('ok', false, 'reason', 'admins_only'); end if;
      if v_to is null then return jsonb_build_object('ok', false, 'reason', 'recipient_required'); end if;
    else
      v_to := case when v_conv.user_low = p_sender then v_conv.user_high else v_conv.user_low end;
      if p_recipient is not null and p_recipient <> v_to then return jsonb_build_object('ok', false, 'reason', 'recipient_invalid'); end if;
    end if;
    if v_to is null or v_to = p_sender then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
    if not exists (select 1 from public.conversation_members where conversation_id = p_conversation and user_id = v_to and left_at is null) then
      return jsonb_build_object('ok', false, 'reason', 'recipient_invalid');
    end if;
  end if;
  if v_to is null or v_to = p_sender then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if exists (select 1 from public.blocks where (blocker_id = p_sender and blocked_id = v_to) or (blocker_id = v_to and blocked_id = p_sender)) then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;
  if exists (select 1 from public.profiles where id = v_to and is_suspended) then return jsonb_build_object('ok', false, 'reason', 'recipient_unavailable'); end if;

  -- the sticker, exactly as the member was shown it (an administrator's edit waits for this gift, or this gift sees it)
  select * into v_st from public.gift_stickers where id = p_sticker for share;
  if v_st.id is null or not v_st.published or v_st.archived_at is not null then return jsonb_build_object('ok', false, 'reason', 'sticker_unavailable'); end if;
  if v_st.revision <> p_expected_revision or v_st.price_fgc <> p_expected_price then
    return jsonb_build_object('ok', false, 'reason', 'sticker_changed', 'revision', v_st.revision, 'price', v_st.price_fgc);
  end if;
  v_bp := (p_rules ->> 'recipientShareBp')::int;
  v_share := div(v_st.price_fgc::numeric * v_bp, 10000)::bigint;
  v_fee := v_st.price_fgc - v_share;
  if v_share < 1 then return jsonb_build_object('ok', false, 'reason', 'below_minimum'); end if;

  perform public.ensure_gift_wallet(p_sender);
  perform public.ensure_gift_wallet(v_to);
  -- both FGC wallets, locked in a FIXED order (user id), so two opposite gifts never deadlock
  perform 1 from public.ai_product_balances where product = 'frenz_gift' and user_id in (p_sender, v_to) order by user_id for update;
  select * into v_ex from public.gift_sends where sender_id = p_sender and idempotency_key = p_idempotency;
  if v_ex.id is not null then
    if v_ex.conversation_id is distinct from p_conversation or v_ex.post_id is distinct from v_post or v_ex.sub_post_id is distinct from v_sub
       or v_ex.sticker_id <> p_sticker or v_ex.recipient_id <> v_to then return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict'); end if;
    return public.gift_send_result(v_ex, true);
  end if;
  v_block := public.gift_send_block_reason(p_sender, p_rules);
  if v_block is not null then return jsonb_build_object('ok', false, 'reason', v_block); end if;
  -- the sender's own due earnings become spendable before the balance is read
  perform public.release_gift_earnings_locked(p_sender);
  select coalesce(sum(price_fgc), 0) into v_sum from public.gift_sends where sender_id = p_sender and status <> 'reversed' and created_at >= now() - interval '24 hours';
  if v_sum + v_st.price_fgc > (p_rules ->> 'dailyMaxFgc')::bigint then
    return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'used', v_sum, 'limit', (p_rules ->> 'dailyMaxFgc')::bigint);
  end if;
  select balance_cents, pending_cents into v_bal, v_pend from public.ai_product_balances where user_id = p_sender and product = 'frenz_gift';
  if v_bal - v_pend < v_st.price_fgc then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'available', v_bal - v_pend, 'needed', v_st.price_fgc);
  end if;

  v_id := gen_random_uuid();
  v_hold := (p_rules ->> 'holdHours')::int;
  v_snap := jsonb_build_object('name', v_st.name, 'description', v_st.description, 'rarity', v_st.rarity, 'category', v_st.category,
                               'image_url', v_st.image_url, 'animation_url', v_st.animation_url, 'slug', v_st.slug);
  perform set_config('frenz.gift_writer', 'on', true);
  update public.ai_product_balances set balance_cents = balance_cents - v_st.price_fgc, updated_at = now()
   where user_id = p_sender and product = 'frenz_gift' returning balance_cents into v_s_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (p_sender, 'frenz_gift', 'gift_sent', 'settled', -v_share, v_s_after + v_fee, 'FGC', 'gift:' || v_id::text, 'Sticker gift: ' || v_st.name, 0,
          jsonb_build_object('gift_id', v_id, 'recipient_id', v_to, 'sticker_id', v_st.id, 'revision', v_st.revision, 'price', v_st.price_fgc, 'rules_version', p_rules -> 'version'))
  returning id into v_sent;
  if v_fee > 0 then
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
    values (p_sender, 'frenz_gift', 'gift_fee', 'settled', -v_fee, v_s_after, 'FGC', 'gift-fee:' || v_id::text, 'Gift commission', 0,
            jsonb_build_object('gift_id', v_id, 'commission_bp', (p_rules ->> 'commissionBp')::int, 'rules_version', p_rules -> 'version'))
    returning id into v_fee_row;
    insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, withdrawable_part)
    values ('gift_commission', v_fee_row, 'gift:' || v_id::text, p_sender, v_fee, 'FGC', 0)
    on conflict (source, source_ledger_id) do nothing;
  end if;
  update public.ai_product_balances set balance_cents = balance_cents + v_share, pending_cents = pending_cents + v_share, updated_at = now()
   where user_id = v_to and product = 'frenz_gift' returning balance_cents into v_r_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (v_to, 'frenz_gift', 'gift_earning', 'reserved', v_share, v_r_after, 'FGC', 'gift:' || v_id::text, 'Gift received: ' || v_st.name, 0,
          jsonb_build_object('gift_id', v_id, 'sender_id', p_sender, 'sticker_id', v_st.id, 'revision', v_st.revision, 'hold_until', now() + make_interval(hours => v_hold)))
  returning id into v_earn;
  insert into public.gift_sends (id, sender_id, recipient_id, conversation_id, post_id, sub_post_id, message_client_id, sticker_id, sticker_revision, price_fgc, recipient_share, commission,
                                 share_bp, commission_bp, hold_hours, hold_until, rules_version, rules_snapshot, sticker_snapshot, idempotency_key, status,
                                 sent_ledger_id, fee_ledger_id, earning_ledger_id)
  values (v_id, p_sender, v_to, p_conversation, v_post, v_sub, 'gift-' || v_id::text, v_st.id, v_st.revision, v_st.price_fgc, v_share, v_fee,
          v_bp, (p_rules ->> 'commissionBp')::int, v_hold, now() + make_interval(hours => v_hold), (p_rules ->> 'version')::bigint, p_rules, v_snap, p_idempotency, 'pending',
          v_sent, v_fee_row, v_earn)
  returning * into v_ex;
  perform set_config('frenz.gift_writer', 'off', true);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_sender, 'gift_sent', 'gift', v_id::text, 'gift:' || v_id::text,
          jsonb_build_object('recipient_id', v_to, 'conversation_id', p_conversation, 'post_id', v_post, 'sub_post_id', v_sub, 'sticker_id', v_st.id, 'revision', v_st.revision, 'price', v_st.price_fgc,
                             'share', v_share, 'commission', v_fee, 'hold_until', v_ex.hold_until, 'rules_version', p_rules -> 'version'));
  return public.gift_send_result(v_ex, false) || jsonb_build_object('balance_after', v_s_after, 'post_id', v_post, 'sub_post_id', v_sub);
end;
$$;

-- 0296 send_gift_batch, restated: a null conversation is allowed when frenz.gift_place names the place (only
-- send_place_gift_batch sets it), and the replay comparisons are null-safe. Everything else is 0296's.
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
  v_place  text := case when p_conversation is null then nullif(current_setting('frenz.gift_place', true), '') end;
  i        int := 0;
begin
  if p_sender is null or (p_conversation is null and v_place is null) or p_sticker is null or p_quantity is null or p_quantity < 1 or p_quantity > 10
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
    if v_ex.batch_id is null or v_ex.batch_size <> p_quantity or v_ex.conversation_id is distinct from p_conversation
       or (p_conversation is null and v_place is distinct from case when v_ex.post_id is not null then 'post:' || v_ex.post_id::text when v_ex.sub_post_id is not null then 'sub_post:' || v_ex.sub_post_id::text end)
       or v_ex.sticker_id <> p_sticker or v_ex.note is distinct from v_note or (p_recipient is not null and v_ex.recipient_id <> p_recipient) then
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
            jsonb_build_object('quantity', p_quantity, 'gift_ids', to_jsonb(v_ids), 'conversation_id', p_conversation, 'place', v_place, 'sticker_id', p_sticker, 'has_note', v_note is not null));
  exception
    when sqlstate 'GB001' then
      -- everything this batch made is rolled back with the savepoint. The refusal names the copy it stopped at.
      get stacked diagnostics v_detail = pg_exception_detail;
      insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
      values (p_sender, 'gift_refused', 'gift_batch', null, null,
              jsonb_build_object('reason', v_detail::jsonb ->> 'reason', 'quantity', p_quantity, 'failed_at', i, 'sticker_id', p_sticker, 'conversation_id', p_conversation, 'place', v_place));
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

-- A gift on a post or an exclusive post (several copies, one transaction — send_gift_batch). Service role only: the
-- server passes the signed-in member as p_sender, and has already checked an exclusive post is visible to them.
create or replace function public.send_place_gift_batch(
  p_sender uuid, p_kind text, p_place uuid, p_sticker uuid, p_expected_revision integer, p_expected_price bigint,
  p_quantity integer, p_note text, p_idempotency text, p_rules jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  if p_kind is null or p_kind not in ('post', 'sub_post') or p_place is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  perform set_config('frenz.gift_place', p_kind || ':' || p_place::text, true);
  v_out := public.send_gift_batch(p_sender, null, null, p_sticker, p_expected_revision, p_expected_price, p_quantity, p_note, p_idempotency, p_rules);
  perform set_config('frenz.gift_place', '', true);
  return v_out;
end;
$$;

-- 0296 claim, plus the gift's place: a post gift's notification opens the post, not a chat (lib/gift/gift-notify.ts).
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
                            'conversation_id', v_g.conversation_id, 'post_id', v_g.post_id, 'sub_post_id', v_g.sub_post_id, 'sticker_name', v_g.sticker_snapshot ->> 'name',
                            'batch_index', coalesce(v_g.batch_index, 1), 'batch_size', coalesce(v_g.batch_size, 1));
end;
$$;

do $$
begin
  revoke all on function public.send_gift(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb) from public, anon, authenticated, service_role;
  revoke all on function public.send_gift_batch(uuid, uuid, uuid, uuid, integer, bigint, integer, text, text, jsonb) from public, anon, authenticated;
  grant execute on function public.send_gift_batch(uuid, uuid, uuid, uuid, integer, bigint, integer, text, text, jsonb) to service_role;
  revoke all on function public.send_place_gift_batch(uuid, text, uuid, uuid, integer, bigint, integer, text, text, jsonb) from public, anon, authenticated;
  grant execute on function public.send_place_gift_batch(uuid, text, uuid, uuid, integer, bigint, integer, text, text, jsonb) to service_role;
end
$$;
