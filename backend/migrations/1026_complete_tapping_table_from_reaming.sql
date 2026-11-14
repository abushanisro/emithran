-- ============================================================================
-- Migration 1026: complete tblTapping for every material cut code
-- ============================================================================
-- memory/Machining/lookup/tblTapping.csv is PARTIAL: the source was cut off
-- after material code 2.2, so 72 of the reference's 91 cut codes (aluminum
-- 30.x, stainless 5.x, copper 33.x, titanium 23.x, plastics, ...) have no
-- tapping row and every thread in those materials was unpriced.
--
-- The rows that are present follow one rule exactly, on all 18 codes both
-- tables share:
--   fine band   (pitch 0.5 and 1.0 mm)  = tblReaming "Virtual Ream, Carbide"
--                                         cutting speed of the same code
--   coarse band (pitch 3.0 and 6.35 mm) = fine speed x 0.38, to 0.1 m/min
-- The missing rows are written by that rule from the staged tblReaming and
-- marked DERIVED. Cross-check: aluminum 30.11 gives 27.2 m/min, inside the
-- published 20 to 40 m/min for HSS taps in wrought aluminum.
--
-- Idempotent: only a (cut code, pitch) the table does not hold is added.
-- ============================================================================

WITH tap AS (
  SELECT id, raw FROM machining_reference_data
  WHERE category = 'lookup_table' AND source_version = '2026-03' AND key = 'tblTapping'
), ream AS (
  SELECT DISTINCT ON ((r->>'MaterialCutCodeName')::numeric)
    (r->>'MaterialCutCodeName')::numeric AS code, r->'Hardness' AS hardness, r->'HardnessSystem' AS hardness_system,
    (r->>'CuttingSpeedMPerMin')::numeric AS speed
  FROM machining_reference_data m, jsonb_array_elements(m.raw) r
  WHERE m.category = 'lookup_table' AND m.source_version = '2026-03' AND m.key = 'tblReaming'
    AND r->>'ToolSeries' = 'Virtual Ream, Carbide'
  ORDER BY (r->>'MaterialCutCodeName')::numeric, (r->>'DiameterMm')::numeric
), derived AS (
  SELECT jsonb_agg(jsonb_build_object(
    '_status', 'DERIVED - tblReaming carbide speed of the same cut code (fine band), x 0.38 (coarse band); migration 1026',
    'ToolType', 'Tap', 'ToolSeries', 'Virtual Tap, High Speed Steel',
    'MaterialCutCodeName', ream.code, 'Hardness', ream.hardness, 'HardnessSystem', ream.hardness_system,
    'CuttingSpeedMPerMin', CASE WHEN p.pitch <= 1 THEN ream.speed ELSE round(ream.speed * 0.38, 1) END,
    'MetricPitchMm', p.pitch, 'ToolLifeMin', 15, 'ToolLifeCostUSD', 6
  ) ORDER BY ream.code, p.pitch) AS rows
  FROM ream CROSS JOIN (VALUES (0.5), (1.0), (3.0), (6.35)) AS p(pitch), tap
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(tap.raw->'rows') t
    WHERE (t->>'MaterialCutCodeName')::numeric = ream.code AND (t->>'MetricPitchMm')::numeric = p.pitch
  )
)
UPDATE machining_reference_data m
SET raw = jsonb_set(m.raw, '{rows}', (m.raw->'rows') || derived.rows),
    value = jsonb_array_length((m.raw->'rows') || derived.rows)::text,
    notes = 'Staged from memory/Machining/lookup/tblTapping.csv; codes missing in the source derived from tblReaming (migration 1026)'
FROM tap, derived
WHERE m.id = tap.id AND derived.rows IS NOT NULL;

-- Verify (expect 364 = 91 codes x 4 pitches):
-- SELECT jsonb_array_length(raw->'rows') FROM machining_reference_data WHERE key = 'tblTapping';
