-- ============================================================================
-- Migration 912: electronics design revisions and rate-versioned cost snapshots
-- ============================================================================
-- A design is one logical board or harness. A revision is one fixed set of input files for it,
-- identified by a hash of the file names and contents. Revisions are immutable: changed inputs
-- are a new revision, never an edit, and the same inputs sent twice resolve to the same revision
-- (so a retry cannot create a duplicate upload or cost result).
--
-- Every cost result now records the revision it priced and the exact rates it used:
--   rates_used    the rate records read (machine-hour and labour rates with their mhr_records id and
--                 version stamps, or reference rows with their source), as they were at calculation time
--   rate_version  a hash of rates_used, so two results compare by one value and a later rate change
--                 never alters a stored result
--
-- Tenancy is the same as migration 909: organization members read, and may insert designs and
-- revisions for their own organization; nothing is updated or deleted by end users.
-- Existing uploads and results keep a NULL revision_id (created before revisions existed).
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.electronics_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  kind text NOT NULL CHECK (kind IN ('board', 'harness')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS electronics_designs_org ON public.electronics_designs (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.electronics_design_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id uuid NOT NULL REFERENCES public.electronics_designs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  revision text NOT NULL CHECK (length(btrim(revision)) > 0),
  -- sha256 over the sorted "name:sha256" lines of the revision files
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (design_id, revision),
  UNIQUE (design_id, input_sha256)
);

CREATE INDEX IF NOT EXISTS electronics_design_revisions_design
  ON public.electronics_design_revisions (design_id, created_at DESC);

ALTER TABLE public.ecad_uploads
  ADD COLUMN IF NOT EXISTS revision_id uuid REFERENCES public.electronics_design_revisions(id);

CREATE UNIQUE INDEX IF NOT EXISTS ecad_uploads_one_per_revision
  ON public.ecad_uploads (revision_id) WHERE revision_id IS NOT NULL;

ALTER TABLE public.electronics_cost_results
  ADD COLUMN IF NOT EXISTS revision_id uuid REFERENCES public.electronics_design_revisions(id),
  ADD COLUMN IF NOT EXISTS rate_version text,
  ADD COLUMN IF NOT EXISTS rates_used jsonb;

ALTER TABLE public.electronics_designs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electronics_design_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_electronics_designs ON public.electronics_designs;
CREATE POLICY org_select_electronics_designs ON public.electronics_designs FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

DROP POLICY IF EXISTS org_insert_electronics_designs ON public.electronics_designs;
CREATE POLICY org_insert_electronics_designs ON public.electronics_designs FOR INSERT
  WITH CHECK (organization_id IN (SELECT current_user_org_ids()) AND created_by = auth.uid());

DROP POLICY IF EXISTS org_select_electronics_design_revisions ON public.electronics_design_revisions;
CREATE POLICY org_select_electronics_design_revisions ON public.electronics_design_revisions FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

-- A revision can only be added to a design of the same organization, which the caller can see.
DROP POLICY IF EXISTS org_insert_electronics_design_revisions ON public.electronics_design_revisions;
CREATE POLICY org_insert_electronics_design_revisions ON public.electronics_design_revisions FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT current_user_org_ids())
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.electronics_designs d
      WHERE d.id = design_id AND d.organization_id = electronics_design_revisions.organization_id
    )
  );

-- An upload may point only at a revision of its own organization (the foreign key alone would let a
-- caller attach their upload to another organization revision by id).
DROP POLICY IF EXISTS org_insert_ecad_uploads ON public.ecad_uploads;
CREATE POLICY org_insert_ecad_uploads ON public.ecad_uploads FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT current_user_org_ids())
    AND created_by = auth.uid()
    AND (
      revision_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.electronics_design_revisions r
        WHERE r.id = revision_id AND r.organization_id = ecad_uploads.organization_id
      )
    )
  );
