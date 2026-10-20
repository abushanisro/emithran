-- ============================================================================
-- Migration 909: electronics costing foundation (Phase 1)
-- ============================================================================
-- Storage for the PCBA / wire-harness costing vertical: customer uploads, the versioned
-- feature graphs parsed from them, the job rows the API hands back, and the versioned cost
-- results. Reference data (rates, price snapshots, costing profiles) arrives with its own
-- phase and its own migration.
--
-- Tenancy: every table carries organization_id and is readable only by active members of
-- that organization (current_user_org_ids(), migration 541). Users may INSERT uploads and
-- job rows for their own organization. Everything the worker writes (graphs, results,
-- upload status) goes through the service role, so no user UPDATE or DELETE policy exists.
--
-- Design files are customer IP. The files themselves live in the private storage bucket
-- below, reachable only by the service role under an organization-prefixed path; no bucket
-- policy is created, so no end-user token can read it.
--
-- Result rows and graph rows are insert-only: a recalculation is a new row, never an edit.
-- Idempotent.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('electronics-uploads', 'electronics-uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ecad_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  created_by uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('board', 'harness')),
  input_tier text NOT NULL CHECK (input_tier IN ('A', 'B', 'C', 'D')),
  -- [{ name, sizeBytes, sha256, storagePath, format }]
  files jsonb NOT NULL,
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'parsing', 'needs_review', 'confirmed', 'failed')),
  -- { code, message } when status = failed; never customer file content
  failure jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ecad_uploads_org ON public.ecad_uploads (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.electronics_feature_graphs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  upload_id uuid NOT NULL REFERENCES public.ecad_uploads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('board', 'harness')),
  contract_version text NOT NULL,
  review_status text NOT NULL CHECK (review_status IN ('needs_review', 'confirmed')),
  graph jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS electronics_feature_graphs_upload
  ON public.electronics_feature_graphs (upload_id, created_at DESC);

-- The id the API returns to a caller. The queue keeps its own job id; this row ties it to
-- an organization so a job status read is checked by RLS like every other read.
CREATE TABLE IF NOT EXISTS public.electronics_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  upload_id uuid NOT NULL REFERENCES public.ecad_uploads(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('parse', 'quote')),
  queue_job_id text NOT NULL,
  -- quote jobs only: the inputs the result is a function of
  batch_size integer CHECK (batch_size IS NULL OR batch_size >= 1),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS electronics_jobs_upload ON public.electronics_jobs (upload_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.electronics_cost_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  upload_id uuid NOT NULL REFERENCES public.ecad_uploads(id) ON DELETE CASCADE,
  feature_graph_id uuid NOT NULL REFERENCES public.electronics_feature_graphs(id),
  result_version text NOT NULL,
  batch_size integer NOT NULL CHECK (batch_size >= 1),
  -- null when any applicable engine reported a gap: a partial sum is never stored as the cost
  assembly_cost_per_unit numeric,
  complete boolean NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (complete = (assembly_cost_per_unit IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS electronics_cost_results_upload
  ON public.electronics_cost_results (upload_id, created_at DESC);

ALTER TABLE public.ecad_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electronics_feature_graphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electronics_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.electronics_cost_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_ecad_uploads ON public.ecad_uploads;
CREATE POLICY org_select_ecad_uploads ON public.ecad_uploads FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

DROP POLICY IF EXISTS org_insert_ecad_uploads ON public.ecad_uploads;
CREATE POLICY org_insert_ecad_uploads ON public.ecad_uploads FOR INSERT
  WITH CHECK (organization_id IN (SELECT current_user_org_ids()) AND created_by = auth.uid());

DROP POLICY IF EXISTS org_select_electronics_feature_graphs ON public.electronics_feature_graphs;
CREATE POLICY org_select_electronics_feature_graphs ON public.electronics_feature_graphs FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

DROP POLICY IF EXISTS org_select_electronics_jobs ON public.electronics_jobs;
CREATE POLICY org_select_electronics_jobs ON public.electronics_jobs FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));

DROP POLICY IF EXISTS org_insert_electronics_jobs ON public.electronics_jobs;
CREATE POLICY org_insert_electronics_jobs ON public.electronics_jobs FOR INSERT
  WITH CHECK (organization_id IN (SELECT current_user_org_ids()) AND created_by = auth.uid());

DROP POLICY IF EXISTS org_select_electronics_cost_results ON public.electronics_cost_results;
CREATE POLICY org_select_electronics_cost_results ON public.electronics_cost_results FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));
