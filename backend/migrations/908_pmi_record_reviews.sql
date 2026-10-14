-- ============================================================================
-- Migration 908: engineer review of decoded PMI values (append-only audit log)
-- ============================================================================
-- A tolerance, nominal or datum reference that the CAD engine could only DECODE from the
-- drawn glyphs of a STEP file is never trusted automatically. An authorized engineer
-- approves or rejects it after checking an authoritative source; that decision is one row
-- here. Rows are never updated except to mark them superseded by a later decision, so the
-- table is the full audit history of every decision on every record.
--
-- An approval is bound to:
--   record_fingerprint  the content of the record when it was reviewed (annotation, values,
--                       how they were obtained, model faces); computed by the CAD engine
--   file_sha256         the STEP file the PMI was read from
-- If either differs from the part current analysis, the approval is stale and counts for
-- nothing until the record is reviewed again. That comparison is also made inside the write
-- function below, in the same transaction, against the stored record.
--
-- record_key is the record id (pmi:<annotation>) for a whole record, or the id plus
-- #datum_refs for the datum references of a frame whose zone is native: a separate claim.
--
-- Who may review: an active owner of the item organization (organization_members.role).
-- No role for engineers exists yet; widening this is one condition in the function below.
--
-- Direct writes are not allowed: RLS gives organization members SELECT only, and the only way
-- to add a row is review_pmi_record(), which checks the role, locks, checks staleness and
-- eligibility, and writes the row and supersedes the previous one in one transaction.
-- Approved values are copied from the STORED record, never from the caller.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pmi_record_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_item_id uuid NOT NULL REFERENCES public.bom_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  record_key text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('record', 'datum_refs')),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  record_fingerprint text NOT NULL,
  file_sha256 text NOT NULL,
  reviewer_id uuid NOT NULL,
  reviewer_email text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  approved_values jsonb NOT NULL,
  decoded_status text NOT NULL,
  provenance jsonb NOT NULL,
  basis text NOT NULL CHECK (basis IN ('engineering_drawing', 'cad_model_pmi', 'customer_specification', 'other')),
  notes text,
  superseded_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS pmi_record_reviews_one_current
  ON public.pmi_record_reviews (bom_item_id, record_key) WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS pmi_record_reviews_item ON public.pmi_record_reviews (bom_item_id, record_key, reviewed_at DESC);

ALTER TABLE public.pmi_record_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_pmi_record_reviews ON public.pmi_record_reviews;
CREATE POLICY org_select_pmi_record_reviews ON public.pmi_record_reviews FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

REVOKE INSERT, UPDATE, DELETE ON public.pmi_record_reviews FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.review_pmi_record(
  p_bom_item_id uuid,
  p_record_key text,
  p_scope text,
  p_decision text,
  p_record_fingerprint text,
  p_basis text,
  p_notes text DEFAULT NULL
) RETURNS public.pmi_record_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_graph jsonb;
  v_record_id text;
  v_rec jsonb;
  v_file text;
  v_expected text;
  v_status text;
  v_current public.pmi_record_reviews;
  v_values jsonb;
  v_row public.pmi_record_reviews;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_scope NOT IN ('record', 'datum_refs') OR p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  SELECT organization_id, feature_graph INTO v_org, v_graph FROM public.bom_items WHERE id = p_bom_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = v_uid AND organization_id = v_org AND status = 'active' AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_bom_item_id::text || '|' || p_record_key, 0));

  v_record_id := regexp_replace(p_record_key, '#datum_refs$', '');
  SELECT r INTO v_rec FROM jsonb_array_elements(COALESCE(v_graph #> '{pmi,records}', '[]'::jsonb)) AS r WHERE r ->> 'id' = v_record_id LIMIT 1;
  IF v_rec IS NULL THEN
    RAISE EXCEPTION 'record_not_found' USING ERRCODE = 'P0002';
  END IF;
  v_file := v_graph #>> '{pmi,source,file_sha256}';
  IF v_file IS NULL THEN
    RAISE EXCEPTION 'no_source_fingerprint' USING ERRCODE = '22023';
  END IF;

  v_status := v_rec #>> '{validation,status}';
  IF p_scope = 'record' THEN
    v_expected := v_rec ->> 'fingerprint';
    IF v_status NOT IN ('decoded_cross_checked', 'decoded_unverified') THEN
      RAISE EXCEPTION 'not_reviewable:%', v_status USING ERRCODE = '22023';
    END IF;
  ELSE
    v_expected := v_rec ->> 'datum_refs_fingerprint';
    IF v_expected IS NULL OR v_rec -> 'datum_refs_validation' IS NULL THEN
      RAISE EXCEPTION 'not_reviewable:no_datum_refs' USING ERRCODE = '22023';
    END IF;
    IF v_status IN ('conflict', 'unresolved') THEN
      RAISE EXCEPTION 'not_reviewable:%', v_status USING ERRCODE = '22023';
    END IF;
  END IF;
  IF v_expected IS NULL OR v_expected <> p_record_fingerprint THEN
    RAISE EXCEPTION 'stale_record' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_current FROM public.pmi_record_reviews
    WHERE bom_item_id = p_bom_item_id AND record_key = p_record_key AND superseded_at IS NULL;
  IF FOUND AND v_current.decision = p_decision AND v_current.record_fingerprint = p_record_fingerprint AND v_current.file_sha256 = v_file THEN
    RETURN v_current;
  END IF;

  IF p_scope = 'record' THEN
    v_values := jsonb_build_object(
      'unit', 'mm',
      'nominal_mm', v_rec #> '{nominal,value}',
      'lower_mm', v_rec #> '{tolerance,lower_mm}',
      'upper_mm', v_rec #> '{tolerance,upper_mm}',
      'min_mm', v_rec #> '{tolerance,min_mm}',
      'max_mm', v_rec #> '{tolerance,max_mm}',
      'zone_mm', v_rec #> '{zone,value}',
      'datum_refs', v_rec -> 'datum_refs',
      'letter', v_rec -> 'letter'
    );
  ELSE
    v_values := jsonb_build_object('unit', 'mm', 'zone_mm', v_rec #> '{zone,value}', 'datum_refs', v_rec -> 'datum_refs');
  END IF;

  UPDATE public.pmi_record_reviews SET superseded_at = now()
    WHERE bom_item_id = p_bom_item_id AND record_key = p_record_key AND superseded_at IS NULL;

  INSERT INTO public.pmi_record_reviews (
    bom_item_id, organization_id, record_key, scope, decision, record_fingerprint, file_sha256,
    reviewer_id, reviewer_email, approved_values, decoded_status, provenance, basis, notes
  ) VALUES (
    p_bom_item_id, v_org, p_record_key, p_scope, p_decision, p_record_fingerprint, v_file,
    v_uid, auth.jwt() ->> 'email', v_values, v_status,
    jsonb_build_object('source', v_rec -> 'source', 'provenance', v_rec -> 'provenance', 'validation', v_rec -> 'validation', 'feature_ref', v_rec -> 'feature_ref'),
    p_basis, p_notes
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.review_pmi_record(uuid, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_pmi_record(uuid, text, text, text, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
