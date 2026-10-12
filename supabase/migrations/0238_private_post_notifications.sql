-- Private posts (formerly SUB): a member can ask to hear when a creator publishes a new private
-- post, and choose how - push, email, or both (owner 2026-10-12). Extends the existing per-person
-- notification preferences (0129) instead of a second table.
alter table public.creator_notification_prefs add column if not exists private_posts text not null default 'off';
alter table public.creator_notification_prefs drop constraint if exists creator_notification_prefs_private_posts_chk;
alter table public.creator_notification_prefs add constraint creator_notification_prefs_private_posts_chk check (private_posts in ('off', 'push', 'email', 'both'));
