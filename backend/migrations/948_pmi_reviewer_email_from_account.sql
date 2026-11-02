-- ============================================================================
-- Migration 948: a PMI review records the reviewer's account email, not the email claim of the caller's token
-- ============================================================================
-- review_pmi_record (908) wrote reviewer_email from auth.jwt() ->> 'email': whatever the token said. The audit row must name the
-- account that made the decision, so the email now comes from auth.users by reviewer_id (= auth.uid(), checked by 908), set by a
-- trigger on every insert: no write path, current or future, can put another value there. 908 itself is unchanged.
-- Idempotent; does nothing where pmi_record_reviews does not exist.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pmi_record_reviews_reviewer_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.reviewer_email := (SELECT lower(u.email) FROM auth.users u WHERE u.id = NEW.reviewer_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.pmi_record_reviews_reviewer_email() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF to_regclass('public.pmi_record_reviews') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS pmi_record_reviews_reviewer_email ON public.pmi_record_reviews;
    CREATE TRIGGER pmi_record_reviews_reviewer_email BEFORE INSERT OR UPDATE OF reviewer_id, reviewer_email ON public.pmi_record_reviews
      FOR EACH ROW EXECUTE FUNCTION public.pmi_record_reviews_reviewer_email();
  END IF;
END $$;
