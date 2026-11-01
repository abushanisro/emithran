-- 936: quality-control rows belong to an organization; a caller sees and changes only their own organizations' rows, and a row
-- that could not be attributed is visible to nobody. The quality tables below carry only the columns 936 relies on (the real ones
-- predate the numbered migrations).
ALTER TABLE public.projects ADD COLUMN organization_id uuid;
GRANT SELECT ON public.projects TO authenticated; -- as in the live database (the insert/update policy looks the project up)
CREATE TABLE public.quality_inspections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid, name text);
CREATE TABLE public.quality_inspection_results (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inspection_id uuid UNIQUE REFERENCES public.quality_inspections(id));
CREATE TABLE public.quality_non_conformances (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inspection_id uuid REFERENCES public.quality_inspections(id));
CREATE TABLE public.detailed_inspection_reports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), inspection_id uuid UNIQUE REFERENCES public.quality_inspections(id));
CREATE TABLE public.quality_approved_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bom_item_id uuid NOT NULL);
-- an older policy that let everyone read everything: 936 must remove it
ALTER TABLE public.quality_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_read_all ON public.quality_inspections FOR SELECT USING (true);
-- stand-in for migration 201's trigger function
CREATE FUNCTION public.generate_qc_certificate_number() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

INSERT INTO public.organizations (id) VALUES ('aaaaaaaa-0000-4000-8000-000000000001'), ('bbbbbbbb-0000-4000-8000-000000000002');
INSERT INTO public.projects (id, organization_id) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-0000000000c1', NULL);
INSERT INTO public.quality_inspections (id, project_id, name) VALUES
  ('11111111-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-0000000000a1', 'A inspection'),
  ('11111111-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-0000000000b1', 'B inspection'),
  ('11111111-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-0000000000c1', 'unattributed');
INSERT INTO public.quality_inspection_results (inspection_id)
  SELECT id FROM public.quality_inspections;
INSERT INTO public.quality_non_conformances (inspection_id)
  SELECT id FROM public.quality_inspections;
INSERT INTO public.detailed_inspection_reports (inspection_id)
  SELECT id FROM public.quality_inspections;
INSERT INTO public.bom_items (id, organization_id) VALUES
  ('22222222-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('22222222-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('22222222-0000-4000-8000-00000000000c', NULL);
INSERT INTO public.quality_approved_items (bom_item_id) SELECT id FROM public.bom_items;

\i /migrations/936_quality_control_tenancy.sql
\i /migrations/936_quality_control_tenancy.sql

DO $$
BEGIN
  ASSERT (SELECT organization_id FROM public.quality_inspections WHERE name = 'A inspection') = 'aaaaaaaa-0000-4000-8000-000000000001', 'inspection takes its project''s organization';
  ASSERT (SELECT organization_id FROM public.quality_inspections WHERE name = 'unattributed') IS NULL, 'no organization is guessed';
  ASSERT (SELECT count(*) FROM public.quality_inspection_results WHERE organization_id IS NOT NULL) = 2, 'results take their inspection''s organization';
  ASSERT (SELECT count(*) FROM public.quality_non_conformances WHERE organization_id IS NOT NULL) = 2, 'non-conformances too';
  ASSERT (SELECT count(*) FROM public.detailed_inspection_reports WHERE organization_id IS NOT NULL) = 2, 'detailed reports too';
  ASSERT (SELECT count(*) FROM public.quality_approved_items WHERE organization_id IS NOT NULL) = 2, 'approved items take their BOM item''s organization';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'quality_inspections' AND policyname = 'legacy_read_all'), 'older wider policies are gone';
  ASSERT (SELECT prosecdef FROM pg_proc WHERE proname = 'generate_qc_certificate_number'), 'certificate numbering still counts every row';
END $$;

-- A member of organization A, as PostgREST would run the request.
SET ROLE authenticated;
SELECT set_config('test.org_ids', 'aaaaaaaa-0000-4000-8000-000000000001', false);

DO $$
DECLARE n integer;
BEGIN
  ASSERT (SELECT count(*) FROM public.quality_inspections) = 1, 'sees only organization A''s inspection';
  ASSERT (SELECT name FROM public.quality_inspections) = 'A inspection', 'and it is A''s';
  ASSERT (SELECT count(*) FROM public.quality_inspection_results) = 1, 'only A''s results';
  ASSERT (SELECT count(*) FROM public.quality_non_conformances) = 1, 'only A''s non-conformances';
  ASSERT (SELECT count(*) FROM public.detailed_inspection_reports) = 1, 'only A''s detailed reports';
  ASSERT (SELECT count(*) FROM public.quality_approved_items) = 1, 'only A''s approved items';
  ASSERT NOT EXISTS (SELECT 1 FROM public.quality_inspections WHERE id = '11111111-0000-4000-8000-00000000000b'), 'B''s inspection by id: not found';
  ASSERT NOT EXISTS (SELECT 1 FROM public.quality_inspections WHERE id = '11111111-0000-4000-8000-00000000000c'), 'the unattributed one: not found';

  UPDATE public.quality_inspections SET name = 'taken' WHERE id = '11111111-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'cannot update B''s inspection';
  UPDATE public.quality_inspections SET name = 'taken' WHERE id = '11111111-0000-4000-8000-00000000000c';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'cannot update the unattributed inspection';
  DELETE FROM public.quality_inspections WHERE id = '11111111-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'cannot delete B''s inspection';

  BEGIN
    INSERT INTO public.quality_inspections (project_id, name, organization_id)
      VALUES ('00000000-0000-4000-8000-0000000000b1', 'x', 'bbbbbbbb-0000-4000-8000-000000000002');
    RAISE EXCEPTION 'inserted an inspection into organization B';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.quality_inspections (project_id, name, organization_id)
      VALUES ('00000000-0000-4000-8000-0000000000b1', 'x', 'aaaaaaaa-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'attached an organization A inspection to B''s project';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.quality_inspections (name) VALUES ('no organization');
    RAISE EXCEPTION 'inserted an inspection without an organization';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.quality_inspections SET organization_id = 'bbbbbbbb-0000-4000-8000-000000000002' WHERE name = 'A inspection';
    RAISE EXCEPTION 'moved an inspection to organization B';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.quality_non_conformances (inspection_id, organization_id)
      VALUES ('11111111-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'attached a non-conformance to B''s inspection';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  INSERT INTO public.quality_inspections (project_id, name, organization_id)
    VALUES ('00000000-0000-4000-8000-0000000000a1', 'new A', 'aaaaaaaa-0000-4000-8000-000000000001');
  INSERT INTO public.quality_non_conformances (inspection_id, organization_id)
    VALUES ('11111111-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001');
  ASSERT (SELECT count(*) FROM public.quality_inspections) = 2, 'A can create its own inspection';
END $$;

-- Someone in no organization sees nothing.
SELECT set_config('test.org_ids', '', false);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.quality_inspections) = 0, 'no organization, no inspections';
  ASSERT (SELECT count(*) FROM public.quality_approved_items) = 0, 'no organization, no approved items';
END $$;

RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT name FROM public.quality_inspections WHERE id = '11111111-0000-4000-8000-00000000000b') = 'B inspection', 'B''s inspection is unchanged';
  ASSERT (SELECT name FROM public.quality_inspections WHERE id = '11111111-0000-4000-8000-00000000000c') = 'unattributed', 'and so is the unattributed one';
END $$;
