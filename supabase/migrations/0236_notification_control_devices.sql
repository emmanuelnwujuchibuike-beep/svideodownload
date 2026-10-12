-- 0236 — Notification Control Center and Device Manager (Feature 20 · Parts 5-6, 2026-10-12).
--
--   notification_settings gains
--     rules         the member's Delivery Rules: [{ id, when: { group, from }, then }] — first match wins.
--                   then: immediate | summary | in_app. Never applies to security or critical alerts
--                   (enforced in lib/notifications/rules.ts, not trusted from here).
--     lock_screen   what a push may show on a locked screen: full | no_preview | hidden
--   push_subscriptions gains
--     label         the member's own name for a device ("Work laptop")
--
-- Additive. Idempotent. No semicolon inside any quoted string. No dollar-quoted block.

alter table public.notification_settings add column if not exists rules jsonb not null default '[]'::jsonb;
alter table public.notification_settings add column if not exists lock_screen text not null default 'full';

alter table public.notification_settings drop constraint if exists notification_settings_lock_screen_chk;
alter table public.notification_settings add constraint notification_settings_lock_screen_chk check (lock_screen in ('full', 'no_preview', 'hidden'));
alter table public.notification_settings drop constraint if exists notification_settings_rules_array_chk;
alter table public.notification_settings add constraint notification_settings_rules_array_chk check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) <= 30);

comment on column public.notification_settings.rules is '0236: Delivery Rules, first match wins. Validated and capped by the API. Security and critical alerts are never subject to them.';
comment on column public.notification_settings.lock_screen is '0236: lock-screen privacy for pushes - full, no_preview (generic text) or hidden (no sender, no text, no photo).';

alter table public.push_subscriptions add column if not exists label text;
alter table public.push_subscriptions drop constraint if exists push_subscriptions_label_len_chk;
alter table public.push_subscriptions add constraint push_subscriptions_label_len_chk check (label is null or char_length(label) between 1 and 40);

comment on column public.push_subscriptions.label is '0236: the member''s own name for this device, shown in the Device Manager.';
