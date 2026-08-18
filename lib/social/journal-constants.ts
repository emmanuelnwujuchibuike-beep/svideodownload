/**
 * Pure journal constants — split out of `lib/social/journal.ts` for the same
 * reason `profile-moods.ts` was split out of `profile.ts`: that file imports
 * `@/lib/supabase/admin` (the service-role client) at module top with no
 * `server-only` guard, and the one CLIENT component that needed this limit
 * (`private-journal-card.tsx`) was pulling that whole admin-client module
 * into the browser bundle just to read a number.
 */
export const JOURNAL_CONTENT_MAX = 2000;
