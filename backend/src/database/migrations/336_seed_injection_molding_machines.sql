-- Migration 336: Seed capability specs for injection molding machines.
-- UPDATE-by-pattern — no new rows (mhr_records is user-owned, no user_id at migration time).
-- Fills max_tonnage where NULL so the machine selector can evaluate clamp-force fit.
--
-- Three passes:
--   1. Named models (Arburg, Engel, KraussMaffei, Milacron) — most accurate
--   2. kN value parsed from machine_name (e.g. "Injection Molder 1,000kN Clamp Force" → 100T)
--   3. Commodity-code defaults (IM-SMALL → 150T, IM-MED → 500T, IM-LARGE → 2000T)
--
-- Pass 3 is a safe catch-all: any record that is classified as injection molding
-- but still has NULL max_tonnage after passes 1-2 gets a conservative class default.
-- This ensures the selector always has a clamp-force boundary to filter against
-- instead of silently accepting undersized machines.
--
-- Mirror of seed-registry.ts INJECTION_MOLDING_SEED_ENTRIES — keep both in sync.

-- ── Pass 1: Named models ──────────────────────────────────────────────────────

-- Arburg Allrounder 370 (37T), 570 (57T), 720 (72T), 1020 (102T), 1600 (160T), 2000 (200T)
UPDATE mhr_records SET
  max_tonnage = 37,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'arburg.*allrounder.*370|allrounder.*370' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 57,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'arburg.*allrounder.*570|allrounder.*570' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 102,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'arburg.*allrounder.*1020|allrounder.*1020' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 160,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'arburg.*allrounder.*1600|allrounder.*1600' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 200,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'arburg.*allrounder.*2000|allrounder.*2000' AND max_tonnage IS NULL AND capability_source IS NULL;

-- Engel e-mac 310 (31T), e-mac 440 (44T), victory 80 (80T), victory 120 (120T), duo 650 (650T)
UPDATE mhr_records SET
  max_tonnage = 31,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'engel.*e-?mac.*310|e-?mac.*310' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 44,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'engel.*e-?mac.*440|e-?mac.*440' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 80,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'engel.*(victory|v-duo).*80\b' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 120,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'engel.*(victory|v-duo).*120\b' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 650,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'engel.*duo.*650|duo.*650' AND max_tonnage IS NULL AND capability_source IS NULL;

-- KraussMaffei CX 50 (50T), CX 80 (80T), CX 160 (160T), GX 450 (450T), GX 650 (650T)
UPDATE mhr_records SET
  max_tonnage = 50,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'kraussmaffei.*cx.?50\b|cx.?50\b' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 160,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'kraussmaffei.*cx.?160|cx.?160' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 450,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'kraussmaffei.*gx.?450|gx.?450' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 650,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'kraussmaffei.*gx.?650|gx.?650' AND max_tonnage IS NULL AND capability_source IS NULL;

-- Milacron Roboshot 110 (110T), 165 (165T), 330 (330T)
UPDATE mhr_records SET
  max_tonnage = 110,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'milacron.*roboshot.*110|roboshot.*110' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 165,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'milacron.*roboshot.*165|roboshot.*165' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 330,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE machine_name ~* 'milacron.*roboshot.*330|roboshot.*330' AND max_tonnage IS NULL AND capability_source IS NULL;

-- ── Pass 2: Parse kN from machine_name ───────────────────────────────────────
-- "Injection Molder 1,000kN Clamp Force" → regexp strips commas, extracts digits, divides by 10
-- Only matches records classified as injection molding class to avoid false positives.
-- Guard: machine_class or commodity_code must identify the machine as an injection molder.

UPDATE mhr_records SET
  max_tonnage = round(
    replace((regexp_match(machine_name, '(\d[\d,]*)\s*kN', 'i'))[1], ',', '')::numeric / 10
  ),
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE max_tonnage IS NULL
  AND capability_source IS NULL
  AND (
    machine_class ~* 'injection\s*mol|injection\s*mold|IMM'
    OR commodity_code ~* '^IM-'
    OR process_group ~* 'injection\s*mol|plastic\s*mol'
    OR machine_name ~* 'injection\s*mol|injection\s*mold'
  )
  AND machine_name ~* '\d[\d,]*\s*kN'
  AND (regexp_match(machine_name, '(\d[\d,]*)\s*kN', 'i'))[1] IS NOT NULL;

-- Parse direct tonnage value: "Injection Molder 150T" / "IMM 200 Ton"
UPDATE mhr_records SET
  max_tonnage = round(
    replace((regexp_match(machine_name, '(\d[\d,]*)\s*[Tt](?:on|ons|onne|onnes)?(?:\s|$|[^a-zA-Z])', 'i'))[1], ',', '')::numeric
  ),
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE max_tonnage IS NULL
  AND capability_source IS NULL
  AND (
    machine_class ~* 'injection\s*mol|injection\s*mold|IMM'
    OR commodity_code ~* '^IM-'
    OR process_group ~* 'injection\s*mol|plastic\s*mol'
    OR machine_name ~* 'injection\s*mol|injection\s*mold'
  )
  AND machine_name ~* '\d[\d,]*\s*[Tt](?:on|ons|onne|onnes)?(?:\s|$)'
  AND (regexp_match(machine_name, '(\d[\d,]*)\s*[Tt](?:on|ons|onne|onnes)?(?:\s|$|[^a-zA-Z])', 'i'))[1] IS NOT NULL;

-- ── Pass 3: Commodity-code class defaults ─────────────────────────────────────
-- Conservative class-level tonnage so any remaining NULL machines at least have
-- a boundary. Machines with NULL max_tonnage pass the capability check silently
-- (null guard in selector.ts:309) — better to have an explicit conservative cap
-- so the selector can score fit and warn on undersized machines.

UPDATE mhr_records SET
  max_tonnage = 150,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE commodity_code = 'IM-SMALL' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 500,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE commodity_code = 'IM-MED' AND max_tonnage IS NULL AND capability_source IS NULL;

UPDATE mhr_records SET
  max_tonnage = 2000,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE commodity_code = 'IM-LARGE' AND max_tonnage IS NULL AND capability_source IS NULL;

-- Generic injection molding class rows with no commodity code match
UPDATE mhr_records SET
  max_tonnage = 250,
  capability_source = 'seed', capability_version = COALESCE(capability_version, 1), capability_updated_at = now()
WHERE max_tonnage IS NULL
  AND capability_source IS NULL
  AND (
    machine_class ~* 'injection\s*mol|injection\s*mold|IMM'
    OR process_group ~* 'injection\s*mol|plastic\s*mol'
    OR machine_name ~* 'injection\s*mol|injection\s*mold'
  )
  AND commodity_code NOT LIKE 'IM-%';
