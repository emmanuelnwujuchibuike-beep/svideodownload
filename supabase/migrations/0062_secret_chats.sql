-- 0062_secret_chats.sql
-- Frenzsave · Premium Messaging V2 Part 11b: real, narrowly-scoped E2E
-- encryption for a new "secret" conversation type — 1:1 ONLY (group E2EE
-- re-keying is out of scope for v1). The server NEVER holds a decryption
-- key or plaintext for these conversations: `messages.body` stores
-- base64 ciphertext, `encryption_iv` stores the per-message AES-GCM nonce.
-- Regular ('direct'/'group') conversations are completely unaffected —
-- they stay server-readable so full-text search (0051) and moderation
-- keep working exactly as before.
--
-- Crypto model (documented here since it drives the shape of this schema):
-- each user generates a long-term ECDH (P-256) key pair client-side; the
-- private key never leaves the device (IndexedDB only). Starting a secret
-- chat derives a per-conversation AES-GCM key via ECDH(myPrivate,
-- theirPublic) — deterministic, never stored server-side, re-derived on
-- each device that already has the private key. This is real encryption
-- (the server genuinely cannot read it) but is NOT a full Double Ratchet
-- (no per-message forward secrecy) and does NOT support multiple devices
-- per account — losing the device that generated the key permanently loses
-- that conversation's history, same as WhatsApp's own documented behavior
-- for a lost E2EE key. `user_encryption_keys` is deliberately a flat
-- one-row-per-user table (not a ratchet-state store) so a future round can
-- swap in a real ratchet without redesigning who-stores-what.

alter table public.conversations drop constraint if exists conversations_type_chk;
alter table public.conversations drop constraint if exists conversations_shape_chk;

alter table public.conversations add constraint conversations_type_chk
  check (type in ('direct', 'group', 'secret'));
alter table public.conversations add constraint conversations_shape_chk check (
  (type in ('direct', 'secret') and user_low is not null and user_high is not null and user_low < user_high)
  or
  (type = 'group' and user_low is null and user_high is null)
);

-- A user can have at most one secret thread with a given other user, same
-- one-thread-per-pair rule 'direct' already has (separate index so a
-- direct AND a secret thread can coexist for the same pair).
create unique index if not exists conversations_secret_pair_uidx
  on public.conversations (user_low, user_high) where type = 'secret';

-- Per-message nonce for the client-side AES-GCM decrypt. NULL for every
-- non-secret message (the overwhelming majority) — `body` stays plaintext
-- there, completely unaffected.
alter table public.messages add column if not exists encryption_iv text;

-- One row per user: their current long-term ECDH public key. Deliberately
-- a single row (not a history table) — rotating keys mid-conversation is a
-- real feature gap for a future round (see the file header), not attempted
-- here. RLS: any authenticated user may read ANY row (public keys are, by
-- definition, not secret — needed to start a secret chat with someone) but
-- may only write their own.
create table if not exists public.user_encryption_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_encryption_keys enable row level security;

drop policy if exists "user_encryption_keys_select_all" on public.user_encryption_keys;
create policy "user_encryption_keys_select_all" on public.user_encryption_keys
  for select using (true);

drop policy if exists "user_encryption_keys_upsert_own" on public.user_encryption_keys;
create policy "user_encryption_keys_upsert_own" on public.user_encryption_keys
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_encryption_keys_update_own" on public.user_encryption_keys;
create policy "user_encryption_keys_update_own" on public.user_encryption_keys
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
