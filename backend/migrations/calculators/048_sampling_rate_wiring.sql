-- ============================================================================
-- Wire "Sampling Rate" -> Lookup Table 6 (sm_lookup_sampling_plan, 15 rows,
-- real seeded data) across all 4 Cost Drivers calculators that have this
-- field. Same class of gap as the others fixed this session: the table and
-- the resolver case ('sampling_plan' in calculators.service.ts) already
-- exist; the field was never connected to them.
-- ============================================================================

UPDATE calculator_fields
SET data_source = 'sheet_metal_lookup', source_field = 'sampling_plan'
WHERE field_name = 'Sampling Rate'
  AND calculator_id IN (
    '450d3468-70b2-41cc-924e-ffe1b17952f7', -- Stamping Cost Drivers
    '0c841b0a-2eaf-4482-9654-9ff366f07fa2', -- TPP Cost Drivers
    '74abe76f-5f27-4600-9369-07576d481f73', -- Drawing/Forming Cost Drivers
    '5f7a6110-5f2f-400d-be79-982894aa7f89', -- Laser Cutting Cost Drivers
    '4e738d77-b818-4c2a-8d44-2e71cbde4d7b'  -- Bending Cost Drivers (same gap, not yet touched this session)
  );

-- Verification:
-- SELECT calculator_id, field_name, data_source, source_field FROM calculator_fields
--   WHERE field_name = 'Sampling Rate';
