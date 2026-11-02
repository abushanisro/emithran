-- Migration 948: a PMI review names the reviewer by their account email, never by the email claim of the caller's token.
-- 908 is not in the shared migration list (it needs bom_items.feature_graph), so it is applied here on top of the stubs, then 948 twice.
\set ON_ERROR_STOP on
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.bom_items ADD COLUMN IF NOT EXISTS feature_graph jsonb;
\i /migrations/908_pmi_record_reviews.sql
\i /migrations/948_pmi_reviewer_email_from_account.sql
\i /migrations/948_pmi_reviewer_email_from_account.sql

INSERT INTO auth.users (id, email) VALUES ('11111111-0000-0000-0000-000000000001', 'Owner@Example.com');
INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'owner');
INSERT INTO public.bom_items (id, organization_id, feature_graph) VALUES ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
  '{"pmi":{"source":{"file_sha256":"f1"},"records":[{"id":"pmi:1","fingerprint":"fp1","validation":{"status":"decoded_unverified"}}]}}');

-- the owner reviews, with a token whose email claim names someone else
SELECT set_config('test.uid', '11111111-0000-0000-0000-000000000001', false);
SELECT set_config('test.jwt', '{"email":"someone-else@example.com"}', false);
SET ROLE authenticated;
SELECT reviewer_email FROM public.review_pmi_record('cccccccc-0000-0000-0000-000000000001', 'pmi:1', 'record', 'approved', 'fp1', 'engineering_drawing');
RESET ROLE;

DO $$ BEGIN
  ASSERT (SELECT reviewer_email FROM public.pmi_record_reviews WHERE superseded_at IS NULL) = 'owner@example.com',
    'the review names the account email, not the token claim';
END $$;

-- no write path can choose the value: a direct insert (the service role) and a later edit are overwritten from the account too
INSERT INTO public.pmi_record_reviews (bom_item_id, organization_id, record_key, scope, decision, record_fingerprint, file_sha256, reviewer_id,
                                       reviewer_email, approved_values, decoded_status, provenance, basis, superseded_at)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'pmi:1', 'record', 'rejected', 'fp0', 'f0',
        '11111111-0000-0000-0000-000000000001', 'forged@example.com', '{}', 'decoded_unverified', '{}', 'other', now());
UPDATE public.pmi_record_reviews SET reviewer_email = 'forged@example.com';
DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM public.pmi_record_reviews WHERE reviewer_email IS DISTINCT FROM 'owner@example.com'), 'no forged reviewer email is stored';
END $$;
