-- ============================================================================
-- Migration 842: sheet-metal operation kinds, and which kinds make each CAD
-- feature variant
-- ============================================================================
-- The sheet-metal operation catalog (process_taxonomy_operations, migration
-- 609, from memory/Sheetmetal/process/process_operations.csv) lists, per
-- process, the operations it can perform on each reference feature type
-- (Turret Press: Punching//SimpleHole, Nibbling//SimpleHole,
-- Perforating//SimpleHole, Flanging//SimpleHole, Countersinking//SimpleHole,
-- Tapping//SimpleHole ...). The CAD engine reports what a feature IS (type +
-- variant, cad-engine/sheet_metal/feature_models.py), never which operation
-- makes it. These two tables connect the two, as data:
--
--   sm_operation_kinds        every catalog operation name -> one kind
--   sm_feature_variant_kinds  every CAD feature variant    -> the kinds that
--                                                            can produce it
--
-- The operations a step performs on a feature are then that step catalog rows
-- whose operation kind is one the feature variant allows. A new process,
-- machine or operation name is a data row here, not code.
--
-- Kinds (from the catalog own operation names):
--   cut        separating cut by a beam, jet or router tool
--   bevel_cut  the same cut with a bevelled edge
--   shear      straight-blade shearing
--   punch      one press hit with a matching tool (punch, pierce, blank)
--   nibble     overlapping hits along a contour no single tool covers
--   perforate  a repeated identical-hole pattern
--   flange     hole flanging (formed collar)
--   countersink, tap
--   trim       die trimming of an edge
--   die_aux    die-station support steps (piloting, tipping, idle)
--   press      a single-station press doing the whole feature (Std Press)
--   bend       discrete bend (press brake, die bending)
--   roll       roll bending (continuous curvature)
--   form       forming, stamping, drawing
--   emboss     embossing
--   draw       drawing over a punch (hydroform deep draw / fluid cell)
--   handling, cleaning, adjusting, inspection
--              per-cycle hydroform steps (Loading, Clean Tooling, Hand
--              Adjusting, Visual Inspection): they make no feature
--   lance      lancing
--   finishing  restrike / set / score / coin / shave / deslag: a process
--              option applied to an already-made feature (CLAUDE.md
--              Restriking/Setting/Coining/Scoring finding), never what makes it
--   no_cost    catalog placeholder, not an operation
--   as_is      the surface as supplied or as formed, no operation
--
-- Variant -> kinds:
--   SimpleHole/through    cut, punch, nibble, press
--   SimpleHole/perforated perforate  (sm_reference_data
--                         defaultNumIdentHolesPerforating defines the pattern)
--   SimpleHole/extruded   flange     (hole-flanging, CLAUDE.md Flanging finding)
--   SimpleHole/countersunk countersink (a cone coaxial with the hole mouth,
--                         CAD engine; the hole itself is still made first)
--   SimpleHole/tapped     tap        (a thread the drawing calls out; the CAD
--                         engine sees only the pilot hole, which is still made
--                         by its own operation)
--   ComplexHole/slot      cut, punch, nibble, press
--   Blank/default         cut, shear, punch, nibble, trim, press
--                         (default = square edge: the CAD engine reports no
--                         bevel, so bevel_cut does not make it)
--   StraightBend/default  bend, press (a roll bender cannot make a discrete
--                         bend, engine-kernel rollBendingGeometryCapability)
--   Form/emboss           emboss, form, press
--   Form/rolled           roll
--   Form/drawn            draw       (CAD drawn shell, drawn_shell.py)
--   Lance/default         lance, press
-- A kind with no row for a variant does not make that variant.
--
-- Idempotent (upsert). Run once; re-run after editing.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sm_operation_kinds (
  operation_category text PRIMARY KEY,
  kind text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sm_feature_variant_kinds (
  feature_type text NOT NULL,
  variant text NOT NULL,
  kind text NOT NULL,
  PRIMARY KEY (feature_type, variant, kind)
);

ALTER TABLE public.sm_operation_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sm_feature_variant_kinds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sm_operation_kinds_read ON public.sm_operation_kinds;
CREATE POLICY sm_operation_kinds_read ON public.sm_operation_kinds FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS sm_feature_variant_kinds_read ON public.sm_feature_variant_kinds;
CREATE POLICY sm_feature_variant_kinds_read ON public.sm_feature_variant_kinds FOR SELECT TO authenticated USING (true);

INSERT INTO public.sm_operation_kinds (operation_category, kind) VALUES
  ('Laser Cutting', 'cut'), ('Fiber Laser Cutting', 'cut'), ('3D Laser Cutting', 'cut'),
  ('Plasma Cutting', 'cut'), ('OxyFuel Cutting', 'cut'), ('Waterjet Cutting', 'cut'),
  ('Router Cutting', 'cut'), ('Laser Cut', 'cut'), ('Fiber Laser Cut', 'cut'),
  ('Plasma Cut', 'cut'), ('Waterjet Cut', 'cut'),
  ('Laser Bevel Cutting', 'bevel_cut'), ('Fiber Laser Bevel Cutting', 'bevel_cut'),
  ('Plasma Bevel Cutting', 'bevel_cut'), ('OxyFuel Bevel Cutting', 'bevel_cut'),
  ('Waterjet Bevel Cutting', 'bevel_cut'),
  ('Shear', 'shear'), ('Cutoff', 'shear'),
  ('Punching', 'punch'), ('Piercing', 'punch'), ('Cam Action Piercing', 'punch'),
  ('Blanking', 'punch'), ('Full Blanking', 'punch'),
  ('Nibbling', 'nibble'),
  ('Perforating', 'perforate'),
  ('Flanging', 'flange'), ('Extruding', 'flange'),
  ('Countersinking', 'countersink'), ('CounterSinking', 'countersink'),
  ('Tapping', 'tap'),
  ('Trimming', 'trim'), ('Edge Trimming', 'trim'), ('Post Form Trimming', 'trim'),
  ('Addendum Trimming Post-Forming', 'trim'), ('Cam Action Trimming', 'trim'),
  ('Piloting Edge Trimming', 'trim'), ('Trimming Piloting', 'trim'),
  ('Piloting', 'die_aux'), ('Re Piloting', 'die_aux'), ('Blanking Piloting', 'die_aux'),
  ('Tipping', 'die_aux'), ('Tipping Back', 'die_aux'), ('Idle', 'die_aux'),
  ('Std Press', 'press'),
  ('Bending', 'bend'), ('Cam Action Bending', 'bend'), ('CamOverBending', 'bend'),
  ('DownOverBending', 'bend'), ('Gusset Bending', 'bend'),
  ('2 Roll Bending', 'roll'), ('3 Roll Bending', 'roll'), ('4 Roll Bending', 'roll'),
  ('Forming', 'form'), ('Stamping', 'form'), ('Side Action Forming', 'form'),
  ('Gusset Forming', 'form'), ('Drawing', 'form'), ('Deep Drawing', 'form'),
  ('Embossing', 'emboss'),
  ('Lancing', 'lance'),
  ('Restriking', 'finishing'), ('Setting', 'finishing'), ('Scoring', 'finishing'),
  ('Coining', 'finishing'), ('Shaving', 'finishing'), ('Deslag', 'finishing'),
  ('Deep Draw Forming', 'draw'), ('Fluid Cell Forming', 'draw'),
  ('Loading', 'handling'), ('Unloading', 'handling'),
  ('Clean Tooling', 'cleaning'), ('Hand Adjusting', 'adjusting'), ('Visual Inspection', 'inspection'),
  ('No Cost Feature', 'no_cost'),
  ('As Supplied', 'as_is'), ('As Formed', 'as_is'), ('As Pierced', 'as_is')
ON CONFLICT (operation_category) DO UPDATE SET kind = EXCLUDED.kind;

INSERT INTO public.sm_feature_variant_kinds (feature_type, variant, kind) VALUES
  ('SimpleHole', 'through', 'cut'), ('SimpleHole', 'through', 'punch'),
  ('SimpleHole', 'through', 'nibble'), ('SimpleHole', 'through', 'press'),
  ('SimpleHole', 'perforated', 'perforate'),
  ('SimpleHole', 'extruded', 'flange'),
  ('SimpleHole', 'tapped', 'tap'),
  ('SimpleHole', 'countersunk', 'countersink'),
  ('ComplexHole', 'slot', 'cut'), ('ComplexHole', 'slot', 'punch'),
  ('ComplexHole', 'slot', 'nibble'), ('ComplexHole', 'slot', 'press'),
  ('Blank', 'default', 'cut'), ('Blank', 'default', 'shear'), ('Blank', 'default', 'punch'),
  ('Blank', 'default', 'nibble'), ('Blank', 'default', 'trim'), ('Blank', 'default', 'press'),
  ('StraightBend', 'default', 'bend'), ('StraightBend', 'default', 'press'),
  ('Form', 'emboss', 'emboss'), ('Form', 'emboss', 'form'), ('Form', 'emboss', 'press'),
  ('Form', 'rolled', 'roll'),
  ('Form', 'drawn', 'draw'),
  ('Lance', 'default', 'lance'), ('Lance', 'default', 'press')
ON CONFLICT DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- Verify (expect 0: every sheet-metal catalog operation has a kind):
-- SELECT DISTINCT o.operation_category
-- FROM public.process_taxonomy_operations o
-- JOIN public.process_taxonomy t ON t.id = o.canonical_process_id
-- WHERE t.process_group IN ('Sheet Metal', 'Sheet Metal - Hydroforming') AND o.operation_category IS NOT NULL
--   AND NOT EXISTS (SELECT 1 FROM public.sm_operation_kinds k WHERE k.operation_category = o.operation_category);
