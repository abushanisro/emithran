-- ============================================================================
-- Migration 1039: the finishing cutter's speed and feed per material class
-- ============================================================================
-- A finishing pass is a tool path over a surface: its time is the path length
-- (area over the stepover) over the feed rate. The feed rate is
--   spindle speed x teeth x feed per tooth,
-- with spindle speed = cutting speed / (pi x tool diameter). The finishing
-- calculators (migration 1038) read these per material class from
-- tblMillingFinishing, staged here.
--
-- memory/Machining has no usable table: its milling table is partial (88 rows,
-- finishing rows only for a 0.1 mm ball cutter, no aluminium). These are the
-- eMithran baseline: the published carbide end mill starting values of the
-- University of Pennsylvania MEAM machine shop chart
-- (medesign.seas.upenn.edu, Guides/FeedsAndSpeeds), in metric:
--   CuttingSpeedMPerMin        the chart's surface speed (SFM x 0.3048);
--   FeedPerToothPerDiameter    the chart's chip load over the tool diameter,
--                              which it holds steady across diameters
--                              (0.002 in at 1/4 in = 0.008);
--   ToolDiameterMm, Teeth      the finishing end mill assumed where the
--                              feature does not force a smaller one.
-- Tool steel is not on the chart and takes the titanium row.
--
-- Idempotent: the row is inserted once and never overwritten.
-- ============================================================================

INSERT INTO machining_reference_data (category, source_region, source_version, key, value, notes, raw)
VALUES (
  'lookup_table', 'USA', '2026-03', 'tblMillingFinishing', '7',
  'eMithran baseline: finishing end mill cutting speed and feed per material class, carbide tooling (UPenn MEAM carbide end mill chart, metric)',
  '[
    {"MaterialClass": "aluminum",     "ToolDiameterMm": 10, "Teeth": 3, "CuttingSpeedMPerMin": 183, "FeedPerToothPerDiameter": 0.008},
    {"MaterialClass": "copper_alloy", "ToolDiameterMm": 10, "Teeth": 3, "CuttingSpeedMPerMin": 91,  "FeedPerToothPerDiameter": 0.008},
    {"MaterialClass": "plastic",      "ToolDiameterMm": 10, "Teeth": 2, "CuttingSpeedMPerMin": 183, "FeedPerToothPerDiameter": 0.012},
    {"MaterialClass": "mild_steel",   "ToolDiameterMm": 10, "Teeth": 4, "CuttingSpeedMPerMin": 76,  "FeedPerToothPerDiameter": 0.008},
    {"MaterialClass": "stainless",    "ToolDiameterMm": 10, "Teeth": 4, "CuttingSpeedMPerMin": 61,  "FeedPerToothPerDiameter": 0.004},
    {"MaterialClass": "titanium",     "ToolDiameterMm": 10, "Teeth": 4, "CuttingSpeedMPerMin": 46,  "FeedPerToothPerDiameter": 0.004},
    {"MaterialClass": "tool_steel",   "ToolDiameterMm": 10, "Teeth": 4, "CuttingSpeedMPerMin": 46,  "FeedPerToothPerDiameter": 0.004}
  ]'::jsonb
)
ON CONFLICT (category, source_region, source_version, key) DO NOTHING;
