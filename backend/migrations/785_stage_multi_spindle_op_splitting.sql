-- ============================================================================
-- Migration 785: Stage Multi-Spindle Machining op-splitting physics (2026-09-19)
--
-- Source: memory/machining/lookup/tblMultiSpindleOpSplitting.csv and
-- tblMultiSpindleOpSplittingThresholds.csv (part of the main Machining
-- reference corpus, not the separate Multi-Spindle Maching folder — this is
-- the one piece of genuinely multi-spindle-specific REAL physics data found
-- anywhere in either corpus).
--
-- What this data actually says: given a machine's real spindle count (2/6/8)
-- and a real feature/operation pair, how many stations that operation should
-- be split across (tblMultiSpindleOpSplitting), and the real threshold ratio
-- that decides whether splitting applies at all for that feature/operation
-- (tblMultiSpindleOpSplittingThresholds — e.g. Ring/Rough Turning only
-- splits when the ring's removed volume is >=22% of the part's total
-- removed volume; SimpleHole/Drilling|Pecking only splits when hole-length-
-- to-part-length ratio is >=0.8).
--
-- IMPORTANT — what this data does NOT answer, and what remains a genuine,
-- disclosed gap (not fabricated here): whether a part should route to a
-- multi-spindle machine AT ALL. That's a batch-size/annual-volume economics
-- decision (multi-spindle automatics pay off only at high production volume
-- — the app already collects Annual Volume/Batch Size as scenario inputs),
-- not a geometric feature-detection problem. No new CAD feature detector is
-- built or needed here.
--
-- No real multi-spindle machine with real $/hr rates exists in either
-- reference corpus (checked directly — the Multi-Spindle Maching folder's
-- only "machine" row, "Default Material Stock", has every rate field at
-- 0.0). This migration stages the real op-splitting physics losslessly so
-- it's available the moment real machine rate data exists; it does NOT
-- register a machine_class, process_calculator_mappings row, or wire any
-- cost engine — there is nothing real to cost against yet, and inventing a
-- placeholder rate would silently misprice any quote routed to it (the
-- same anti-pattern already fixed elsewhere this session for CMM/no_db_rate
-- lines).
-- ============================================================================

BEGIN;

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, unit_type, notes, raw) VALUES
('lookup_table', 'USA', '2026-03', 'tblMultiSpindleOpSplitting', NULL, NULL, 'How many stations to split an operation across, by real machine spindle count', $jsonb$[{"feature":"Ring","operation":"Rough Turning","machine_spindles":2,"number_of_operations":1},{"feature":"Ring","operation":"Rough Turning","machine_spindles":6,"number_of_operations":2},{"feature":"Ring","operation":"Rough Turning","machine_spindles":8,"number_of_operations":3},{"feature":"SimpleHole","operation":"Drilling","machine_spindles":2,"number_of_operations":1},{"feature":"SimpleHole","operation":"Drilling","machine_spindles":6,"number_of_operations":3},{"feature":"SimpleHole","operation":"Drilling","machine_spindles":8,"number_of_operations":3},{"feature":"SimpleHole","operation":"Pecking","machine_spindles":2,"number_of_operations":1},{"feature":"SimpleHole","operation":"Pecking","machine_spindles":6,"number_of_operations":3},{"feature":"SimpleHole","operation":"Pecking","machine_spindles":8,"number_of_operations":3}]$jsonb$::jsonb),
('lookup_table', 'USA', '2026-03', 'tblMultiSpindleOpSplittingThresholds', NULL, NULL, 'Real threshold ratio that decides whether op-splitting applies for a feature/operation pair', $jsonb$[{"feature":"Ring","operation":"Rough Turning","enable_operation_splitting":true,"threshold":0.22,"threshold_description":"Ratio of ring removed volume to total removed volume"},{"feature":"SimpleHole","operation":"Drilling","enable_operation_splitting":true,"threshold":0.8,"threshold_description":"Ratio of hole length to part length"},{"feature":"SimpleHole","operation":"Pecking","enable_operation_splitting":true,"threshold":0.8,"threshold_description":"Ratio of hole length to part length"}]$jsonb$::jsonb)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;

COMMIT;

-- Verification (run manually after):
-- SELECT key, jsonb_array_length(raw) FROM machining_reference_data
--   WHERE category = 'lookup_table' AND key LIKE 'tblMultiSpindleOpSplitting%';
-- -- Expect tblMultiSpindleOpSplitting -> 9, tblMultiSpindleOpSplittingThresholds -> 3.
