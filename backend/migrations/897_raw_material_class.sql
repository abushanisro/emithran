-- ============================================================================
-- Migration 897: every raw material carries its material class
--   Ferrous | Non-Ferrous | Plastic & Rubber
-- ============================================================================
-- material_group is the SOURCE CATALOG a row came from (Die Casting, Forging,
-- Sheet Metal Transfer Die, ...; process_material_groups, migration 879, links
-- processes to it). It is not the material class: an aluminum in the Die
-- Casting catalog is non-ferrous, a steel in the Forging catalog is ferrous,
-- and the old "Ferrous & Non-Ferrous" group kept the two together.
--
-- The class is a fact of the material TYPE, so it is stated once per
-- raw_materials.material_type in material_type_classes, with its basis:
--   Ferrous       iron-based: every steel, stainless, galvanized, maraging,
--                 and the cast irons (gray, ductile, malleable).
--   Non-Ferrous   metals that are not iron-based. For the alloy-family names
--                 the basis is the rows themselves: every "Heat Resistant" /
--                 "Heat Resistant Super Alloys" row is a nickel or cobalt alloy
--                 (Inconel, Hastelloy, Haynes, Co Alloy, Mar M), and both
--                 "Manganese" rows are Manganese Bronze (checked 2026-10-09).
--   Plastic & Rubber  every polymer type, and every resin / powder trade name
--                 the source catalogs themselves file under the
--                 "Plastic & Rubber" group (Accura, DuraForm, Vero, VisiJet, ...).
-- Types with no basis stay unclassified (material_class NULL) and are
-- reported, never guessed: Composites (fibre, honeycomb, adhesive mixes),
-- LaserForm (no composition on the rows), Generic, Default, and rows with no
-- material_type at all.
--
-- A trigger keeps the column in step with material_type for every future
-- insert / import / edit, so no code path classifies by keyword again.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.material_type_classes (
  material_type  text PRIMARY KEY,
  material_class text NOT NULL CHECK (material_class IN ('Ferrous', 'Non-Ferrous', 'Plastic & Rubber')),
  basis          text NOT NULL
);

ALTER TABLE public.material_type_classes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS material_type_classes_read ON public.material_type_classes;
CREATE POLICY material_type_classes_read ON public.material_type_classes FOR SELECT TO authenticated USING (true);

INSERT INTO public.material_type_classes (material_type, material_class, basis) VALUES
  -- Ferrous: iron-based
  ('Steel',                  'Ferrous', 'iron-based'),
  ('Carbon Steel',           'Ferrous', 'iron-based'),
  ('Low-Alloy Steel',        'Ferrous', 'iron-based'),
  ('Unalloyed Steel',        'Ferrous', 'iron-based'),
  ('Stainless Steel',        'Ferrous', 'iron-based'),
  ('Stainless Steel Alloy',  'Ferrous', 'iron-based'),
  ('Galvanized Steel',       'Ferrous', 'iron-based'),
  ('Galv. Steel',            'Ferrous', 'iron-based'),
  ('Maraging Steel',         'Ferrous', 'iron-based'),
  ('Maraging Steel Alloy',   'Ferrous', 'iron-based'),
  ('Gray Iron',              'Ferrous', 'cast iron'),
  ('Ductile Iron',           'Ferrous', 'cast iron'),
  ('Malleable Cast Iron',    'Ferrous', 'cast iron'),
  -- Non-Ferrous: metals that are not iron-based
  ('Aluminum',               'Non-Ferrous', 'aluminum'),
  ('Aluminum Alloy',         'Non-Ferrous', 'aluminum'),
  ('Zinc-Aluminum',          'Non-Ferrous', 'zinc / aluminum'),
  ('Zinc',                   'Non-Ferrous', 'zinc'),
  ('Copper',                 'Non-Ferrous', 'copper'),
  ('Brass',                  'Non-Ferrous', 'copper alloy'),
  ('Silicon Brass',          'Non-Ferrous', 'copper alloy'),
  ('Bronze',                 'Non-Ferrous', 'copper alloy'),
  ('Aluminum Bronze',        'Non-Ferrous', 'copper alloy'),
  ('Manganese Bronze',       'Non-Ferrous', 'copper alloy'),
  ('Manganese',              'Non-Ferrous', 'rows are Manganese Bronze'),
  ('Lead',                   'Non-Ferrous', 'lead'),
  ('Magnesium',              'Non-Ferrous', 'magnesium'),
  ('Titanium',               'Non-Ferrous', 'titanium'),
  ('Titanium Alloy',         'Non-Ferrous', 'titanium'),
  ('Nickel Alloy',           'Non-Ferrous', 'nickel'),
  ('Inconel',                'Non-Ferrous', 'nickel alloy'),
  ('Hastelloy',              'Non-Ferrous', 'nickel alloy'),
  ('Haynes Alloy',           'Non-Ferrous', 'nickel alloy'),
  ('Heat Resistant',         'Non-Ferrous', 'rows are nickel / cobalt alloys'),
  ('Heat Resistant Super Alloys', 'Non-Ferrous', 'rows are nickel / cobalt alloys'),
  ('Cobalt Chrome',          'Non-Ferrous', 'cobalt alloy'),
  ('Cobalt Chrome Alloy',    'Non-Ferrous', 'cobalt alloy'),
  -- Plastic & Rubber: polymers
  ('ABS',                    'Plastic & Rubber', 'polymer'),
  ('ABS - Extrusion',        'Plastic & Rubber', 'polymer'),
  ('ABS -Extrusion Sheet GP','Plastic & Rubber', 'polymer'),
  ('Acetal',                 'Plastic & Rubber', 'polymer'),
  ('Acrylic',                'Plastic & Rubber', 'polymer'),
  ('HDPE - Extrusion',       'Plastic & Rubber', 'polymer'),
  ('HDPE - Extrusion Sheet', 'Plastic & Rubber', 'polymer'),
  ('Impact Copolymer',       'Plastic & Rubber', 'polymer'),
  ('Impact Copolymer TPO',   'Plastic & Rubber', 'polymer'),
  ('Nylon',                  'Plastic & Rubber', 'polymer'),
  ('PBT',                    'Plastic & Rubber', 'polymer'),
  ('PEEK',                   'Plastic & Rubber', 'polymer'),
  ('PEI',                    'Plastic & Rubber', 'polymer'),
  ('PES',                    'Plastic & Rubber', 'polymer'),
  ('PET',                    'Plastic & Rubber', 'polymer'),
  ('Polyamide',              'Plastic & Rubber', 'polymer'),
  ('Polyaryletherketone',    'Plastic & Rubber', 'polymer'),
  ('Polycarbonate',          'Plastic & Rubber', 'polymer'),
  ('Polyetheramide',         'Plastic & Rubber', 'polymer'),
  ('Polyethylene',           'Plastic & Rubber', 'polymer'),
  ('Polypropylene',          'Plastic & Rubber', 'polymer'),
  ('Simulated Polypropylene','Plastic & Rubber', 'polymer'),
  ('Polystyrene',            'Plastic & Rubber', 'polymer'),
  ('Polyurethane',           'Plastic & Rubber', 'polymer'),
  ('PP - Extrusion',         'Plastic & Rubber', 'polymer'),
  ('PP - Extrusion Sheet',   'Plastic & Rubber', 'polymer'),
  ('PPO',                    'Plastic & Rubber', 'polymer'),
  ('PPS',                    'Plastic & Rubber', 'polymer'),
  ('PS - Crystal',           'Plastic & Rubber', 'polymer'),
  ('PS - Crystal Injection GP', 'Plastic & Rubber', 'polymer'),
  ('PS - High Impact',       'Plastic & Rubber', 'polymer'),
  ('PS - High Impact Extrusion', 'Plastic & Rubber', 'polymer'),
  ('PVC',                    'Plastic & Rubber', 'polymer'),
  ('SAN',                    'Plastic & Rubber', 'polymer'),
  ('Thermoplastic',          'Plastic & Rubber', 'polymer'),
  ('Thermoplastics',         'Plastic & Rubber', 'polymer'),
  ('Thermoset',              'Plastic & Rubber', 'polymer'),
  ('TPA',                    'Plastic & Rubber', 'elastomer'),
  ('TPE',                    'Plastic & Rubber', 'elastomer'),
  ('TPO',                    'Plastic & Rubber', 'elastomer'),
  ('TPS',                    'Plastic & Rubber', 'elastomer'),
  ('TPU',                    'Plastic & Rubber', 'elastomer'),
  ('TPV',                    'Plastic & Rubber', 'elastomer'),
  ('CastForm',               'Plastic & Rubber', 'rows are polystyrene (PS) powder'),
  -- Plastic & Rubber: trade names the source catalogs file under Plastic & Rubber
  ('Accura',                 'Plastic & Rubber', 'source catalog: Plastic & Rubber'),
  ('Dental',                 'Plastic & Rubber', 'source catalog: Plastic & Rubber'),
  ('DuraForm',               'Plastic & Rubber', 'source catalog: Plastic & Rubber'),
  ('ProtoGen',               'Plastic & Rubber', 'source catalog: Plastic & Rubber'),
  ('ProtoTherm',             'Plastic & Rubber', 'source catalog: Plastic & Rubber'),
  ('Tango',                  'Plastic & Rubber', 'source catalog: Plastic & Rubber'),
  ('V-Flash',                'Plastic & Rubber', 'source catalog: Plastic & Rubber'),
  ('Vero',                   'Plastic & Rubber', 'source catalog: Plastic & Rubber'),
  ('Visijet',                'Plastic & Rubber', 'source catalog: Plastic & Rubber'),
  ('VisiJet Plastic',        'Plastic & Rubber', 'source catalog: Plastic & Rubber'),
  ('VisiJet Wax',            'Plastic & Rubber', 'source catalog: Plastic & Rubber'),
  ('WaterClear',             'Plastic & Rubber', 'source catalog: Plastic & Rubber')
ON CONFLICT (material_type) DO UPDATE
  SET material_class = EXCLUDED.material_class, basis = EXCLUDED.basis;

ALTER TABLE public.raw_materials ADD COLUMN IF NOT EXISTS material_class text;
ALTER TABLE public.raw_materials DROP CONSTRAINT IF EXISTS raw_materials_material_class_check;
ALTER TABLE public.raw_materials ADD CONSTRAINT raw_materials_material_class_check
  CHECK (material_class IS NULL OR material_class IN ('Ferrous', 'Non-Ferrous', 'Plastic & Rubber'));
CREATE INDEX IF NOT EXISTS idx_raw_materials_material_class ON public.raw_materials (material_class);

-- The class follows material_type on every insert and edit.
CREATE OR REPLACE FUNCTION public.raw_materials_set_material_class()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN
  NEW.material_class := (SELECT c.material_class FROM public.material_type_classes c WHERE c.material_type = NEW.material_type);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_raw_materials_material_class ON public.raw_materials;
CREATE TRIGGER trg_raw_materials_material_class
  BEFORE INSERT OR UPDATE OF material_type ON public.raw_materials
  FOR EACH ROW EXECUTE FUNCTION public.raw_materials_set_material_class();

-- Backfill, then report what stayed unclassified.
DO $$
DECLARE
  r record;
BEGIN
  UPDATE public.raw_materials rm
  SET material_class = c.material_class
  FROM public.material_type_classes c
  WHERE c.material_type = rm.material_type
    AND rm.material_class IS DISTINCT FROM c.material_class;

  FOR r IN
    SELECT material_class, count(*) AS n FROM public.raw_materials GROUP BY 1 ORDER BY 1
  LOOP
    RAISE NOTICE 'material_class %: % rows', coalesce(r.material_class, 'UNCLASSIFIED'), r.n;
  END LOOP;
  FOR r IN
    SELECT coalesce(material_type, '(no material_type)') AS t, count(*) AS n
    FROM public.raw_materials WHERE material_class IS NULL GROUP BY 1 ORDER BY 1
  LOOP
    RAISE NOTICE 'unclassified type %: % rows', r.t, r.n;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT material_class, count(*) FROM raw_materials GROUP BY 1 ORDER BY 1;
--   SELECT material_type, count(*) FROM raw_materials WHERE material_class IS NULL GROUP BY 1;
