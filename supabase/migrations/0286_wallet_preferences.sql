-- ═══════════════════════════════════════════════════════════════════════════
--  0286 — the member's own wallet preferences (2026-10-26)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-26 (Wallet setup): notification preferences for money received,
-- money sent and withdrawal updates, and hide the balance by default.
--
-- One jsonb column on the member's existing notification_settings row (0046), read
-- and written by lib/coin/wallet-prefs.ts. That row is already the member's own
-- (policy "notification settings self all") and already holds per-category choices
-- in category_prefs, so no new table, no new policy and no new catalogue entry.
--
--   {
--     "notifyReceived":    true,   push for money in (transfers received, deposits ready)
--     "notifySent":        true,   push for transfers sent
--     "notifyWithdrawals": true,   push for withdrawal updates
--     "hideBalance":       false   the wallet opens with the balance hidden
--   }
--
-- A missing key is its default. These switch PUSH alerts only: every transaction is
-- still recorded in the member's activity and emailed as a receipt (owner, Part 5 -
-- every transaction is emailed), and PIN / security alerts can never be switched off.

alter table public.notification_settings
  add column if not exists wallet_prefs jsonb not null default '{}'::jsonb;

comment on column public.notification_settings.wallet_prefs is
  'Wallet preferences (0286), read by lib/coin/wallet-prefs.ts: notifyReceived, notifySent, notifyWithdrawals (push only - receipts and activity are always kept, security alerts always on) and hideBalance. A missing key is its default.';
