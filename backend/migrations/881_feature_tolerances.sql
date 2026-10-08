-- ============================================================================
-- Migration 881: required tolerances per feature instance (GD&T tab)
-- ============================================================================
-- One row per (BOM item, feature instance, tolerance category) the engineer
-- set by hand ("Manual" in Edit Tolerances). A category with no row is "Auto":
-- it follows the item Tolerance Policy (scenario_overrides.tolerancePolicy).
--
-- feature_key identifies a detected feature instance across re-analysis:
-- feature type + a hash of its faces content-based stable ids (cad-engine
-- shared/stable_face_id.py), built by feature-tolerances.ts. If the geometry
-- of those faces changes, the key changes and the row no longer matches any
-- instance; it is then listed as orphaned, never moved to another feature.
--
-- category is a tblGtolProcessCapabilities GtolCategory (memory/Machining).
-- value: mm (+/- for tolerance and diamTolerance; zone width for geometric
-- tolerances), um for roughness and roughnessRz, degrees for bendAngleTolerance.
--
-- Access follows the parent item organization (migration 549 pattern); the
-- service copies organization_id from the bom_items row.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.feature_tolerances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_item_id uuid NOT NULL REFERENCES public.bom_items(id) ON DELETE CASCADE,
  organization_id uuid,
  feature_key text NOT NULL,
  feature_type text NOT NULL,
  category text NOT NULL CHECK (category IN (
    'tolerance', 'diamTolerance', 'positionTolerance', 'roughness', 'roughnessRz', 'bendAngleTolerance',
    'circularity', 'concentricity', 'cylindricity', 'flatness', 'parallelism', 'perpendicularity',
    'profileOfSurface', 'runout', 'totalRunout', 'straightness', 'symmetry', 'angularity')),
  value numeric NOT NULL CHECK (value > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bom_item_id, feature_key, category)
);

CREATE INDEX IF NOT EXISTS idx_feature_tolerances_bom_item ON public.feature_tolerances(bom_item_id);

ALTER TABLE public.feature_tolerances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_select_feature_tolerances ON public.feature_tolerances;
CREATE POLICY org_select_feature_tolerances ON public.feature_tolerances FOR SELECT
  USING (organization_id IN (SELECT current_user_org_ids()));
DROP POLICY IF EXISTS org_insert_feature_tolerances ON public.feature_tolerances;
CREATE POLICY org_insert_feature_tolerances ON public.feature_tolerances FOR INSERT
  WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
DROP POLICY IF EXISTS org_update_feature_tolerances ON public.feature_tolerances;
CREATE POLICY org_update_feature_tolerances ON public.feature_tolerances FOR UPDATE
  USING (organization_id IN (SELECT current_user_org_ids()))
  WITH CHECK (organization_id IN (SELECT current_user_org_ids()));
DROP POLICY IF EXISTS org_delete_feature_tolerances ON public.feature_tolerances;
CREATE POLICY org_delete_feature_tolerances ON public.feature_tolerances FOR DELETE
  USING (organization_id IN (SELECT current_user_org_ids()));

NOTIFY pgrst, 'reload schema';
