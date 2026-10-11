-- 0231 — the creator closed the "Get paid for your content" card on their profile
-- (owner, 2026-10-11: "they can exit the banner and follow only through the locked
-- icon button"). Remembered on the account, so every device agrees; the SUB POSTS
-- tab keeps everything. Additive and idempotent.

alter table public.creator_membership_settings add column if not exists promo_dismissed_at timestamptz;

comment on column public.creator_membership_settings.promo_dismissed_at is '0231: when the creator closed the Get paid card on their own profile. Null = show it.';
