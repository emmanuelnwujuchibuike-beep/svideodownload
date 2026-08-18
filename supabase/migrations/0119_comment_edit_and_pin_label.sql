-- =====================================================================
-- FrenzSave — Feature 15 Part 5 (Premium Comments), tranche 1:
-- comment editing + labelled multi-pin. Additive + idempotent; reads
-- degrade gracefully if this hasn't run yet (see engagement.ts's
-- EXT/BASE fallback pattern), so it's safe to apply any time.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Editing. `edited_at` is null until the first edit, then stamped on
-- every subsequent one — the UI renders an "Edited" label only when it
-- is non-null, never inferred from updated_at (post_comments has none).
-- ---------------------------------------------------------------------
alter table public.post_comments
  add column if not exists edited_at timestamptz;

-- ---------------------------------------------------------------------
-- Labelled pins. The shipped pin/route.ts set a bare boolean with no cap
-- and no "why" — the brief's Important/Announcement/FAQ/Update/Contest
-- Winner/Guidelines categories imply multiple simultaneous pins are
-- intended, so this adds a label rather than converting to single-pin.
-- The cap (5) and "only one FAQ-typed pin need not be enforced" logic
-- live in the API (app/api/comments/[id]/pin/route.ts), not here — a
-- check constraint can't see how many sibling rows are already pinned.
-- ---------------------------------------------------------------------
alter table public.post_comments
  add column if not exists pin_label text;

alter table public.post_comments drop constraint if exists post_comments_pin_label_chk;
alter table public.post_comments
  add constraint post_comments_pin_label_chk check (
    pin_label is null or pin_label in ('important', 'announcement', 'faq', 'update', 'winner', 'guideline')
  );

-- pinned_at orders multiple pins (most recently pinned first) — pinned
-- alone (a boolean) has no ordering, so today's UI happens to fall back
-- to created_at, which is not the same thing as pin recency.
alter table public.post_comments
  add column if not exists pinned_at timestamptz;
