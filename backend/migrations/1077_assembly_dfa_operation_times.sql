-- ============================================================================
-- Migration 1077: the manual fastening times of the Mechanical Assembly operations (DFA baseline), staged as a lookup table
-- ============================================================================
-- memory/Assembly names the Mechanical Assembly operations (Screw Tighten - Manual / Power, Snap Fit, Press Fit, Rivet, Nut Insert, Tab Bend)
-- but gives no time for any of them, so an assembly's screws and snap fits could not be costed. The industry's published method for manual
-- assembly times is Boothroyd and Dewhurst's Design for Manual Assembly: a part's time is its handling time (a two-digit code for its size,
-- symmetry and handling difficulty) plus its insertion time (a two-digit code for how it is secured). User decision 2026-11-18: stage the
-- published DFA times as the eMithran baseline.
--
-- Only values verified against the published worked example are staged: the controller assembly worksheet of G. Boothroyd, P. Dewhurst and
-- W. Knight, Product Design for Manufacture and Assembly (CRC Press), reproduced as "Worksheet for controller assembly" (Table 4.5):
--   screw:     handling 11 (1.80 s) + insertion 39, screw fastened immediately after insertion (8.00 s)
--   nut:       handling 00 (1.13 s) + insertion 39 (8.00 s)
--   snap fit:  handling 30 (1.95 s) + insertion 31, part secured immediately by a snap fit (5.00 s)
-- Screw Tighten - Power, Press Fit, Rivet and Tab Bend have no verified figure here: they are not staged, and the engine names them as gaps
-- until a plant stages its own times (or the engineer enters one), never a guess.
--
-- Staged beside the assembly reference data (source version 2026-Assembly) as assembly_tblDfaOperationTimes, read like the other tables, and
-- replaced by a plant's own time study like any of them. Idempotent: the row is inserted once and never overwritten.
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, notes, raw)
SELECT 'lookup_table', 'USA', '2026-Assembly', 'assembly_tblDfaOperationTimes', '3',
  'Boothroyd, Dewhurst & Knight, Product Design for Manufacture and Assembly: manual handling + insertion times (controller assembly worksheet, Table 4.5)',
  $raw${"rows": [
    {"Operation": "Screw Tighten - Manual", "Handling Code": "11", "Handling Time (s)": 1.80, "Insertion Code": "39", "Insertion Time (s)": 8.00, "Total Time (s)": 9.80},
    {"Operation": "Nut Insert",             "Handling Code": "00", "Handling Time (s)": 1.13, "Insertion Code": "39", "Insertion Time (s)": 8.00, "Total Time (s)": 9.13},
    {"Operation": "Snap Fit",               "Handling Code": "30", "Handling Time (s)": 1.95, "Insertion Code": "31", "Insertion Time (s)": 5.00, "Total Time (s)": 6.95}
  ]}$raw$::jsonb
WHERE NOT EXISTS (SELECT 1 FROM machining_reference_data WHERE source_version = '2026-Assembly' AND key = 'assembly_tblDfaOperationTimes');

NOTIFY pgrst, 'reload schema';
