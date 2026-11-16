-- ============================================================================
-- Migration 1043: each turning machine's live-tool spindle (live_tooling_power_kw)
-- ============================================================================
-- A cross (radial) hole, or an axial hole off the turning centreline, is drilled
-- on a lathe only with a driven tool: a live-tool spindle (C/Y axis). Without it
-- the hole needs a second operation on a mill. The costing priced such holes on
-- any lathe, so a 2-axis bar-feed lathe with no driven tool was applied to the
-- R_M-0230-032 lead nut housing (5 cross holes, 10 off-axis holes).
--
-- Each machine's live-tool spindle power is in its own memory/ source row:
--   memory/Machining/machine/machiningusa.csv          powers.liveToolingSpindlePowerKw
--   memory/Machining/machine/millturn_usa.csv          powers.live_tooling_spindle_power_kW
--   memory/Machining/machine/simultaneous_turning_usa.csv  rates.live_tooling_spindle_power_kW
--   memory/Machining/machine/stock_prep_lathe_usa.csv  (no live-tooling column: none)
-- A blank cell in a turning machine's row is 0: the source lists the spindle for
-- every machine that has one (every 3-axis lathe, mill-turn and simultaneous
-- turning machine) and for no 2-axis lathe.
--   2_axis_bar_feed_lathe_with_sub_spindle     without a live-tool spindle: 2
--   2_axis_lathe                               without a live-tool spindle: 24
--   3_axis_bar_feed_lathe_with_sub_spindle     with    a live-tool spindle: 2
--   3_axis_lathe                               with    a live-tool spindle: 23
--   machining_millturn                         with    a live-tool spindle: 7
--   simultaneous_turning                       with    a live-tool spindle: 15
--   stock_prep_lathe                           without a live-tool spindle: 24
--
-- Matched by (machine_class, machine_name), every location (India copies too).
-- A machine with no row here keeps NULL: unknown, never assumed. Idempotent.
-- ============================================================================

ALTER TABLE mhr_records ADD COLUMN IF NOT EXISTS live_tooling_power_kw NUMERIC
  CHECK (live_tooling_power_kw IS NULL OR live_tooling_power_kw >= 0);
COMMENT ON COLUMN mhr_records.live_tooling_power_kw IS
  'Live-tool (driven) spindle power, kW: 0 = the machine has none, so it cannot drill a cross or off-axis hole; NULL = not known. From memory/Machining/machine (migration 1043).';

UPDATE mhr_records m
SET live_tooling_power_kw = v.kw, updated_at = now()
FROM (VALUES
  ($n$2_axis_bar_feed_lathe_with_sub_spindle$n$, $n$Haas DS-30 with BAR3010SS Feeder$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_bar_feed_lathe_with_sub_spindle$n$, $n$Haas DS-30SS with BAR3010SS Feeder$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Acra 2800 CET$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Acra 4400 HLA$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Acra MT-34$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Amera-Seiki T-90$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Atrump 940C$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Binns & Berry Data 2000 - 1250$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Binns & Berry Data 3000 - 1250$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$DMG Mori Wasino G-07$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$DMG Mori Wasino J-1$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Daewoo Puma 300 LC$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Danobat VTC-1600$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Danobat VTC-8000H$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$INDEX SpeedLine ABC$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Mazak 6G$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Mazak 6T$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Mazak HQR-150MSY$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Mazak HQR-200MS$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Okuma Genos L250II$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Okuma Genos L400II$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Okuma HL - 20$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Okuma HL - 35$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Virtual 2 Axis Lathe - Large$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Virtual 2 Axis Lathe - Medium$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$2_axis_lathe$n$, $n$Virtual 2 Axis Lathe - Small$n$, 0, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_bar_feed_lathe_with_sub_spindle$n$, $n$Haas DS-30SSY with BAR3010SS Feeder$n$, 14.9, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_bar_feed_lathe_with_sub_spindle$n$, $n$Haas DS-30Y with BAR3010SS Feeder$n$, 14.9, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Boehringer VDF 400$n$, 26.5, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Daewoo Puma 600$n$, 14.9, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Daewoo Puma 700$n$, 13.05, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Daewoo Puma 800$n$, 22.37, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Daewoo Puma MX 2000/2500S$n$, 18.5, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Daewoo Puma MX 2000/2500T$n$, 18.5, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Haas SL 20$n$, 7.5, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Haas SL 40L$n$, 14.9, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Hardinge Quest 6/42 SP$n$, 13.05, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Hardinge Quest 8/51 SP$n$, 11, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$INDEX Speedline C100$n$, 16.5, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Miyano BNC-20$n$, 11.2, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Miyano BND-20S5$n$, 7.45, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Miyano BND-34T5$n$, 8.3, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Miyano BND-34TR$n$, 8.3, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Okuma 2SP-V760EX (M)$n$, 7.5, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Okuma LB2000 EXII (M) Cx300$n$, 5.5, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Okuma LB2000 EXII (M) Cx500$n$, 5.5, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Okuma LB3000 EXII (M) T$n$, 7.1, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Okuma V760EX (M)$n$, 7.5, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Virtual 3 Axis Lathe - Large$n$, 29.83, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Virtual 3 Axis Lathe - Medium$n$, 22.37, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$3_axis_lathe$n$, $n$Virtual 3 Axis Lathe - Small$n$, 14.91, $n$memory/Machining/machine/machiningusa.csv$n$),
  ($n$machining_millturn$n$, $n$GILDEMEISTER GMX 400 LINEAR$n$, 10.7, $n$memory/Machining/machine/millturn_usa.csv$n$),
  ($n$machining_millturn$n$, $n$INDEX RatioLine G200$n$, 5.5, $n$memory/Machining/machine/millturn_usa.csv$n$),
  ($n$machining_millturn$n$, $n$Mazak Integrex e-410H-S II$n$, 11.2, $n$memory/Machining/machine/millturn_usa.csv$n$),
  ($n$machining_millturn$n$, $n$Mazak Integrex e-500H-S II$n$, 11.2, $n$memory/Machining/machine/millturn_usa.csv$n$),
  ($n$machining_millturn$n$, $n$Mazak Integrex e-650H-S II$n$, 11.2, $n$memory/Machining/machine/millturn_usa.csv$n$),
  ($n$machining_millturn$n$, $n$Mazak Integrex e650$n$, 37, $n$memory/Machining/machine/millturn_usa.csv$n$),
  ($n$machining_millturn$n$, $n$Virtual MillTurn$n$, 22.37, $n$memory/Machining/machine/millturn_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$DMG Mori GMC25ISM-6$n$, 15, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Dooson Puma TT2500SY$n$, 26, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$HAAS DS-30Y$n$, 15, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Index MS16C-6$n$, 12, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Index MS22-8$n$, 12, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Index MS32-6$n$, 14, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Index MS40-8$n$, 14, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Tsugami M08SY$n$, 8, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Virtual CNC Multi-Spindle, 6 Spindles, Large$n$, 14, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Virtual CNC Multi-Spindle, 6 Spindles, Small$n$, 12, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Virtual CNC Multi-Spindle, 8 Spindles, Large$n$, 14, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Virtual CNC Multi-Spindle, 8 Spindles, Small$n$, 12, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Virtual CNC Turning Center with Sub Spindle, Large$n$, 28, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Virtual CNC Turning Center with Sub Spindle, Medium$n$, 11, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$simultaneous_turning$n$, $n$Virtual CNC Turning Center with Sub Spindle, Small$n$, 8, $n$memory/Machining/machine/simultaneous_turning_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Acra 2800 CET$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Acra 4400 HLA$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Acra MT-34$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Amera-Seiki T-90$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Atrump 940C$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Binns & Berry Data 2000 - 1250$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Binns & Berry Data 3000 -1250$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Boehringer VDF 400$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Daewoo Puma 300 LC$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Daewoo Puma 600$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Daewoo Puma 700$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Daewoo Puma 800$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Daewoo Puma MX 2000/2500S$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Daewoo Puma MX 2000/2500T$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Haas SL 20$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Haas SL 40L$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Hardinge Quest 6/42 SP$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Hardinge Quest 8/51 SP$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Mazak 6G$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Mazak 6T$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Miyano BNC-20$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Miyano BND-20S5$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Miyano BND-34T5$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$),
  ($n$stock_prep_lathe$n$, $n$Miyano BND-34TR$n$, 0, $n$memory/Machining/machine/stock_prep_lathe_usa.csv$n$)
) AS v(machine_class, machine_name, kw, source)
WHERE m.machine_class = v.machine_class AND m.machine_name = v.machine_name
  AND m.live_tooling_power_kw IS DISTINCT FROM v.kw;
