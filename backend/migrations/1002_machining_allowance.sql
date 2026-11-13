-- ============================================================================
-- Migration 1002: machining allowance data (stock left on a cast face that will be machined)
-- ============================================================================
-- Machining allowance is NOT pattern shrinkage: shrinkage scales the whole pattern for cooling; allowance is extra metal on the faces
-- that are machined afterwards. Every allowance has a source; the resolver (backend) walks them in this order and never invents a value:
--   1. drawing / PMI specified        -> bom_item_machining_allowances, basis engineering_drawing | cad_model_pmi | customer_specification
--   2. licensed ISO 8062-3 dataset    -> machining_allowance_datasets (+ _values)
--   3. approved foundry/customer profile -> machining_allowance_profiles (+ _values), status 'approved'
--   4. engineer's estimate            -> bom_item_machining_allowances, basis engineering_estimate
--   5. otherwise requires_review
--
-- machining_allowance_datasets  An organization's licensed copy of a standard's allowance table (RMAG grade x size band -> mm). The ISO
--                               table is copyrighted: nothing is shipped; the backend imports a licensed file, with its licence reference
--                               and content fingerprint. A dataset and its values are frozen (never changed or deleted); a new edition is
--                               a new dataset. Users read their organization's datasets only.
-- machining_allowance_profiles  A foundry's or customer's published allowances (size band, optionally per material family and moulding
--                               method -> mm), with the document they come from (basis). Submitted by an admin, approved or rejected once
--                               by a DIFFERENT admin (as 962). A profile and its values are frozen; a revision is the next version of the
--                               same name, and every version is kept.
-- bom_item_machining_allowances One part's decision on one feature (the cad-engine feature key, as machining-need uses): machined or
--                               not, the allowance per face, on one or both sides, and why. Append-only as 908: a new decision supersedes
--                               the current one, nothing is edited. Bound to the part's geometry_hash: when the file changes the
--                               decision is stale and counts for nothing until made again.
-- Writes go through the SECURITY DEFINER functions below (role checked in the database too, as 944); users only SELECT. Idempotent.
-- ============================================================================

-- ── 1. licensed datasets ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.machining_allowance_datasets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  standard          text NOT NULL CHECK (char_length(btrim(standard)) >= 3),
  edition           text NOT NULL CHECK (char_length(btrim(edition)) >= 1),
  licence_reference text NOT NULL CHECK (char_length(btrim(licence_reference)) >= 3),
  source_note       text,
  content_sha256    text NOT NULL,
  imported_by       uuid NOT NULL,
  imported_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, content_sha256)
);

CREATE TABLE IF NOT EXISTS public.machining_allowance_dataset_values (
  dataset_id   uuid NOT NULL REFERENCES public.machining_allowance_datasets(id),
  rmag         text NOT NULL CHECK (rmag ~ '^[A-K]$'),
  size_over_mm numeric NOT NULL CHECK (size_over_mm >= 0),
  size_upto_mm numeric NOT NULL,
  allowance_mm numeric NOT NULL CHECK (allowance_mm > 0),
  PRIMARY KEY (dataset_id, rmag, size_over_mm),
  CHECK (size_upto_mm > size_over_mm)
);

-- ── 2. foundry / customer profiles ──────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.machining_allowance_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name            text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  kind            text NOT NULL CHECK (kind IN ('foundry', 'customer')),
  version         integer NOT NULL CHECK (version >= 1),
  basis           text NOT NULL CHECK (char_length(btrim(basis)) BETWEEN 1 AND 500),
  status          text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'rejected')),
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_by     uuid,
  reviewed_at     timestamptz,
  review_note     text CHECK (review_note IS NULL OR char_length(btrim(review_note)) BETWEEN 3 AND 500),
  UNIQUE (organization_id, name, version),
  -- A reviewed profile says who reviewed it and why, and the reviewer is not the one who submitted it.
  CONSTRAINT machining_allowance_profiles_review CHECK (
    (status = 'submitted' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL)
    OR (status <> 'submitted' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL AND reviewed_by <> created_by)
  )
);

CREATE TABLE IF NOT EXISTS public.machining_allowance_profile_values (
  profile_id      uuid NOT NULL REFERENCES public.machining_allowance_profiles(id),
  material_family text,
  moulding_method text CHECK (moulding_method IS NULL OR moulding_method IN ('hand', 'machine', 'no_bake')),
  size_over_mm    numeric NOT NULL CHECK (size_over_mm >= 0),
  size_upto_mm    numeric NOT NULL,
  allowance_mm    numeric NOT NULL CHECK (allowance_mm > 0),
  CHECK (size_upto_mm > size_over_mm)
);
CREATE INDEX IF NOT EXISTS machining_allowance_profile_values_profile ON public.machining_allowance_profile_values (profile_id);

-- ── 3. a part's decisions ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bom_item_machining_allowances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_item_id     uuid NOT NULL REFERENCES public.bom_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  feature_key     text NOT NULL CHECK (char_length(feature_key) BETWEEN 1 AND 200),
  machined        boolean NOT NULL,
  allowance_mm    numeric CHECK (allowance_mm IS NULL OR allowance_mm > 0),
  sides           smallint CHECK (sides IS NULL OR sides IN (1, 2)),
  basis           text NOT NULL CHECK (basis IN ('engineering_drawing', 'cad_model_pmi', 'customer_specification', 'engineering_estimate', 'not_machined')),
  reason          text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 3 AND 500),
  geometry_hash   text NOT NULL,
  set_by          uuid NOT NULL,
  set_by_email    text,
  set_at          timestamptz NOT NULL DEFAULT now(),
  superseded_at   timestamptz,
  -- A machined feature carries its allowance and sides; a feature that is not machined has none.
  CONSTRAINT bom_item_machining_allowances_shape CHECK (
    (machined AND basis <> 'not_machined' AND allowance_mm IS NOT NULL AND sides IS NOT NULL)
    OR (NOT machined AND basis = 'not_machined' AND allowance_mm IS NULL AND sides IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS bom_item_machining_allowances_one_current
  ON public.bom_item_machining_allowances (bom_item_id, feature_key) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS bom_item_machining_allowances_item ON public.bom_item_machining_allowances (bom_item_id, feature_key, set_at DESC);

-- ── frozen rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Datasets and all values: never changed, never deleted (a value table row goes only with nothing; datasets are history).
CREATE OR REPLACE FUNCTION public.machining_allowance_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is frozen: add a new version instead', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END
$$;

DROP TRIGGER IF EXISTS machining_allowance_datasets_frozen ON public.machining_allowance_datasets;
CREATE TRIGGER machining_allowance_datasets_frozen BEFORE UPDATE OR DELETE ON public.machining_allowance_datasets
  FOR EACH ROW EXECUTE FUNCTION public.machining_allowance_frozen();
DROP TRIGGER IF EXISTS machining_allowance_dataset_values_frozen ON public.machining_allowance_dataset_values;
CREATE TRIGGER machining_allowance_dataset_values_frozen BEFORE UPDATE OR DELETE ON public.machining_allowance_dataset_values
  FOR EACH ROW EXECUTE FUNCTION public.machining_allowance_frozen();
DROP TRIGGER IF EXISTS machining_allowance_profile_values_frozen ON public.machining_allowance_profile_values;
CREATE TRIGGER machining_allowance_profile_values_frozen BEFORE UPDATE OR DELETE ON public.machining_allowance_profile_values
  FOR EACH ROW EXECUTE FUNCTION public.machining_allowance_frozen();

-- A profile: only its review may be recorded, once. Never deleted.
CREATE OR REPLACE FUNCTION public.machining_allowance_profiles_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'an allowance profile is never deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.name <> OLD.name OR NEW.kind <> OLD.kind
     OR NEW.version <> OLD.version OR NEW.basis <> OLD.basis OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'an allowance profile is frozen: only its review can be recorded' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'submitted' THEN
    RAISE EXCEPTION 'an allowance profile is reviewed once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS machining_allowance_profiles_frozen ON public.machining_allowance_profiles;
CREATE TRIGGER machining_allowance_profiles_frozen BEFORE UPDATE OR DELETE ON public.machining_allowance_profiles
  FOR EACH ROW EXECUTE FUNCTION public.machining_allowance_profiles_frozen();

-- A decision: only superseded_at may be set, once. Deleted only with its BOM item (cascade).
CREATE OR REPLACE FUNCTION public.bom_item_machining_allowances_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL
     OR (to_jsonb(NEW) - 'superseded_at') <> (to_jsonb(OLD) - 'superseded_at') THEN
    RAISE EXCEPTION 'a machining allowance decision is never edited: make a new one' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS bom_item_machining_allowances_append_only ON public.bom_item_machining_allowances;
CREATE TRIGGER bom_item_machining_allowances_append_only BEFORE UPDATE ON public.bom_item_machining_allowances
  FOR EACH ROW EXECUTE FUNCTION public.bom_item_machining_allowances_append_only();

-- ── read access ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.machining_allowance_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machining_allowance_dataset_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machining_allowance_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machining_allowance_profile_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_item_machining_allowances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_machining_allowance_datasets ON public.machining_allowance_datasets;
CREATE POLICY org_select_machining_allowance_datasets ON public.machining_allowance_datasets FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));
DROP POLICY IF EXISTS org_select_machining_allowance_dataset_values ON public.machining_allowance_dataset_values;
CREATE POLICY org_select_machining_allowance_dataset_values ON public.machining_allowance_dataset_values FOR SELECT
  USING (dataset_id IN (SELECT id FROM public.machining_allowance_datasets WHERE organization_id IN (SELECT current_user_org_ids())));
DROP POLICY IF EXISTS org_select_machining_allowance_profiles ON public.machining_allowance_profiles;
CREATE POLICY org_select_machining_allowance_profiles ON public.machining_allowance_profiles FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));
DROP POLICY IF EXISTS org_select_machining_allowance_profile_values ON public.machining_allowance_profile_values;
CREATE POLICY org_select_machining_allowance_profile_values ON public.machining_allowance_profile_values FOR SELECT
  USING (profile_id IN (SELECT id FROM public.machining_allowance_profiles WHERE organization_id IN (SELECT current_user_org_ids())));
DROP POLICY IF EXISTS org_select_bom_item_machining_allowances ON public.bom_item_machining_allowances;
CREATE POLICY org_select_bom_item_machining_allowances ON public.bom_item_machining_allowances FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.machining_allowance_datasets, public.machining_allowance_dataset_values,
  public.machining_allowance_profiles, public.machining_allowance_profile_values, public.bom_item_machining_allowances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.machining_allowance_datasets, public.machining_allowance_dataset_values,
  public.machining_allowance_profiles, public.machining_allowance_profile_values, public.bom_item_machining_allowances TO authenticated;

-- ── writes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- The caller's active role in an organization, or null.
CREATE OR REPLACE FUNCTION public.machining_allowance_member_role(p_organization_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT role FROM public.organization_members
  WHERE organization_id = p_organization_id AND user_id = auth.uid() AND status = 'active'
  ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.machining_allowance_member_role(uuid) FROM PUBLIC, anon, authenticated;

-- An admin submits a profile (its next version) with its values: [{material_family?, moulding_method?, size_over_mm, size_upto_mm, allowance_mm}].
CREATE OR REPLACE FUNCTION public.submit_machining_allowance_profile(
  p_organization_id uuid, p_name text, p_kind text, p_basis text, p_values jsonb
) RETURNS public.machining_allowance_profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.machining_allowance_profiles;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.machining_allowance_member_role(p_organization_id), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'not an admin of organization %', p_organization_id USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_values) <> 'array' OR jsonb_array_length(p_values) = 0 THEN
    RAISE EXCEPTION 'a profile needs at least one value' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('machining_allowance_profile|' || p_organization_id::text || '|' || btrim(p_name), 0));

  INSERT INTO public.machining_allowance_profiles (organization_id, name, kind, version, basis, created_by)
  VALUES (p_organization_id, btrim(p_name), p_kind,
          coalesce((SELECT max(version) FROM public.machining_allowance_profiles WHERE organization_id = p_organization_id AND name = btrim(p_name)), 0) + 1,
          p_basis, auth.uid())
  RETURNING * INTO v_row;

  INSERT INTO public.machining_allowance_profile_values (profile_id, material_family, moulding_method, size_over_mm, size_upto_mm, allowance_mm)
  SELECT v_row.id, nullif(btrim(v ->> 'material_family'), ''), nullif(btrim(v ->> 'moulding_method'), ''),
         (v ->> 'size_over_mm')::numeric, (v ->> 'size_upto_mm')::numeric, (v ->> 'allowance_mm')::numeric
  FROM jsonb_array_elements(p_values) AS v;

  RETURN v_row;
END
$$;

-- A different admin approves or rejects a submitted profile, once, with a note.
CREATE OR REPLACE FUNCTION public.review_machining_allowance_profile(
  p_profile_id uuid, p_decision text, p_note text
) RETURNS public.machining_allowance_profiles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_row public.machining_allowance_profiles;
BEGIN
  SELECT * INTO v_row FROM public.machining_allowance_profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR coalesce(public.machining_allowance_member_role(v_row.organization_id), '') NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'not an admin of organization %', v_row.organization_id USING ERRCODE = '42501';
  END IF;
  IF v_row.created_by = auth.uid() THEN
    RAISE EXCEPTION 'a profile is reviewed by someone other than its submitter' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid decision %', p_decision USING ERRCODE = '22023';
  END IF;

  UPDATE public.machining_allowance_profiles
     SET status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   WHERE id = p_profile_id
  RETURNING * INTO v_row;
  RETURN v_row;
END
$$;

-- A member decides one feature of one part: machined or not, the allowance per face, one or both sides, the basis and why.
-- The geometry it was decided on is read from the part, never from the caller.
CREATE OR REPLACE FUNCTION public.set_machining_allowance(
  p_bom_item_id uuid, p_feature_key text, p_machined boolean, p_allowance_mm numeric, p_sides integer, p_basis text, p_reason text
) RETURNS public.bom_item_machining_allowances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org uuid;
  v_geometry text;
  v_row public.bom_item_machining_allowances;
BEGIN
  SELECT organization_id, geometry_hash INTO v_org, v_geometry FROM public.bom_items WHERE id = p_bom_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR coalesce(public.machining_allowance_member_role(v_org), '') NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'not a member of organization %', v_org USING ERRCODE = '42501';
  END IF;
  IF v_geometry IS NULL THEN
    RAISE EXCEPTION 'the part has no analysed geometry yet' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('machining_allowance|' || p_bom_item_id::text || '|' || p_feature_key, 0));

  UPDATE public.bom_item_machining_allowances SET superseded_at = now()
   WHERE bom_item_id = p_bom_item_id AND feature_key = p_feature_key AND superseded_at IS NULL;

  INSERT INTO public.bom_item_machining_allowances (
    bom_item_id, organization_id, feature_key, machined, allowance_mm, sides, basis, reason, geometry_hash, set_by, set_by_email
  ) VALUES (
    p_bom_item_id, v_org, p_feature_key, p_machined, p_allowance_mm, p_sides, p_basis, btrim(p_reason), v_geometry, auth.uid(), auth.jwt() ->> 'email'
  ) RETURNING * INTO v_row;
  RETURN v_row;
END
$$;

REVOKE ALL ON FUNCTION public.submit_machining_allowance_profile(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_machining_allowance_profile(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_machining_allowance(uuid, text, boolean, numeric, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_machining_allowance_profile(uuid, text, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_machining_allowance_profile(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_machining_allowance(uuid, text, boolean, numeric, integer, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
