-- ═══════════════════════════════════════════════════════════════════════════
--  0302 — Verification: the applicant's date of birth and company / publication (2026-10-28)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- The verification flow from design/frenz-verification.html (owner, 2026-10-28) asks who the applicant is without an
-- ID document: account type, legal name, DATE OF BIRTH, country, the registered COMPANY (business) or PUBLICATION
-- (journalist), optional links, and a selfie. The two new facts get their own columns. Both are nullable: older
-- applications have neither. Read by the reviewer through the existing admin queue, service role only (0104 RLS).
--
-- Depends on 0104. Safe to run twice. No dollar-quoted block.

alter table public.verification_requests add column if not exists date_of_birth date;
alter table public.verification_requests add column if not exists organization text;
alter table public.verification_requests drop constraint if exists verification_requests_organization_chk;
alter table public.verification_requests add constraint verification_requests_organization_chk check (organization is null or char_length(organization) <= 120);
comment on column public.verification_requests.date_of_birth is 'The applicant''s date of birth as they gave it (0302). Never shown publicly.';
comment on column public.verification_requests.organization is 'The registered company (business) or publication (journalist) the applicant named (0302).';
