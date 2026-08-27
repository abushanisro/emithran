-- ============================================================================
-- Migration: Sheet Metal Lookup Tables -- Blank Addendum Width (staging)
-- Purpose: Lands the "BlankAddendumWidth" lookup-table export (13 rows,
--          Total Form Depth (mm) -> Addendum Width (mm)) into the same
--          lossless staging table earlier Lookup Tables/Variables/Wage Grade
--          migrations (479/482/483) created. See migration 479's header for
--          the staging/promotion architecture.
--
--          NOT promoted anywhere -- "addendum width" is deep-draw/stamping
--          tooling terminology (the extra binder-area material added around
--          a deep-drawn form to control metal flow during forming). This
--          app has no deep-drawing or press-forming capability anywhere
--          (confirmed: zero matches for "addendum"/"form depth" in the
--          codebase) -- same "progressive-die/hard-tooling, no consumer
--          here" pattern as most of the Variables category (migration 479).
--          The 13 rows are a perfectly linear relationship (addendum width
--          = 24% of form depth in every row, e.g. 6/25, 12/50, 60/250,
--          80/325 all = 0.24) -- reference-only, kept for completeness.
-- Author: Principal Engineering Team
-- Date: 2026-08-19
-- Version: 1.0.0
-- ============================================================================

INSERT INTO sm_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:25.00', '6.00',  'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 25.00, "addendumWidthMm": 6.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:50.00', '12.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 50.00, "addendumWidthMm": 12.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:75.00', '18.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 75.00, "addendumWidthMm": 18.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:100.00', '24.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 100.00, "addendumWidthMm": 24.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:125.00', '30.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 125.00, "addendumWidthMm": 30.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:150.00', '36.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 150.00, "addendumWidthMm": 36.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:175.00', '42.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 175.00, "addendumWidthMm": 42.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:200.00', '48.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 200.00, "addendumWidthMm": 48.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:225.00', '54.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 225.00, "addendumWidthMm": 54.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:250.00', '60.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 250.00, "addendumWidthMm": 60.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:275.00', '66.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 275.00, "addendumWidthMm": 66.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:300.00', '72.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 300.00, "addendumWidthMm": 72.00}'::jsonb),
('lookup_table', 'USA', '2026-03', 'BlankAddendumWidth:325.00', '80.00', 'Length', 'Addendum Width (mm) for Total Form Depth (mm) -- deep-draw tooling, no consumer in this app', '{"totalFormDepthMm": 325.00, "addendumWidthMm": 80.00}'::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
