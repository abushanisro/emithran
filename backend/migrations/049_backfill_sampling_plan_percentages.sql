-- ============================================================================
-- Migration 049: Backfill sm_lookup_sampling_plan's sampling_pct_l1/l2/l3
-- columns (2026-08-01)
--
-- All 15 rows had real sample_qty_l1/l2/l3 data (seeded correctly, matches
-- memory/sheetmetal/Lookup_Table_6_Inspection_Sampling.md exactly) but the
-- three sampling_pct_* columns were NULL on every single row — the "Sampling
-- Rate" field this session wired to this table would silently return null
-- despite finding the correct row.
--
-- Values below are transcribed directly from the reference doc (not derived
-- from batch_size_to), because cross-checking confirmed one seeding
-- discrepancy: the doc's last bracket is "500,001-1,000,000" but this table's
-- row 15 has batch_size_to=10,000,000 (10x). sample_qty/batch_size_to holds
-- exactly for the other 14 rows, but using it for row 15 would compound that
-- pre-existing typo into the percentage too — transcribing the doc's own
-- stated percentages avoids that.
-- ============================================================================

UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 25.0000, sampling_pct_l2 = 25.0000, sampling_pct_l3 = 37.5000 WHERE batch_size_from = 2;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 13.3333, sampling_pct_l2 = 20.0000, sampling_pct_l3 = 33.3333 WHERE batch_size_from = 9;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 12.0000, sampling_pct_l2 = 20.0000, sampling_pct_l3 = 32.0000 WHERE batch_size_from = 16;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 10.0000, sampling_pct_l2 = 16.0000, sampling_pct_l3 = 26.0000 WHERE batch_size_from = 26;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 5.5556,  sampling_pct_l2 = 14.4444, sampling_pct_l3 = 22.2222 WHERE batch_size_from = 51;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 5.3333,  sampling_pct_l2 = 13.3333, sampling_pct_l3 = 21.3333 WHERE batch_size_from = 91;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 4.6429,  sampling_pct_l2 = 11.4286, sampling_pct_l3 = 17.8571 WHERE batch_size_from = 151;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 4.0000,  sampling_pct_l2 = 10.0000, sampling_pct_l3 = 16.0000 WHERE batch_size_from = 281;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 2.6667,  sampling_pct_l2 = 6.6667,  sampling_pct_l3 = 10.4167 WHERE batch_size_from = 501;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 1.5625,  sampling_pct_l2 = 3.9062,  sampling_pct_l3 = 6.2500  WHERE batch_size_from = 1201;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 0.8000,  sampling_pct_l2 = 2.0000,  sampling_pct_l3 = 3.1500  WHERE batch_size_from = 3201;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 0.3571,  sampling_pct_l2 = 0.9000,  sampling_pct_l3 = 1.4286  WHERE batch_size_from = 10001;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 0.1333,  sampling_pct_l2 = 0.3333,  sampling_pct_l3 = 0.5333  WHERE batch_size_from = 35001;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 0.0630,  sampling_pct_l2 = 0.1600,  sampling_pct_l3 = 0.2500  WHERE batch_size_from = 150001;
UPDATE sm_lookup_sampling_plan SET sampling_pct_l1 = 0.0500,  sampling_pct_l2 = 0.1250,  sampling_pct_l3 = 0.2000  WHERE batch_size_from = 500001;

-- Verification:
-- SELECT batch_size_from, batch_size_to, sampling_pct_l1, sampling_pct_l2, sampling_pct_l3
--   FROM sm_lookup_sampling_plan ORDER BY batch_size_from;
-- Expect: 0 rows with any sampling_pct_l* still NULL.
