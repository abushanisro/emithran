-- ============================================================================
-- Migration 602: Correct 35 more stale rawmetalusa.json rows (same root
-- cause as migration 601's single Copper UNS C28000 fix, applied at full scale)
-- ============================================================================
-- Root cause (confirmed live via direct query against ALL 98 promotable rows
-- from memory/sheetmetal/rawmetrial/rawmetalusa.json, not sampled): migration
-- 590's `WHERE NOT EXISTS (... material = v.material)` dedup guard silently
-- skipped any "Generic X" row whose exact name already existed from an OLDER
-- bulk import (created_at = 2026-07-18 22:23:14, vs. migration 590's own
-- 2026-08-28 05:19:03 run) -- leaving old, unverified placeholder data live
-- (material_grade NULL in every case) instead of applying the real,
-- ASTM/reference-sourced replacement values migration 590 always intended.
--
-- Verified by direct query across all 98 promotable materials: 62 landed
-- correctly (created_at = 2026-08-28, material_grade populated), 1 was
-- already fixed by migration 601 (Copper UNS C28000), and these 35 were
-- silently blocked -- confirmed by cross-referencing migration 590's own
-- promoteRows literals (backend/migrations/590_seed_sheet_metal_raw_materials.sql)
-- against the live query result.
--
-- Fix: UPDATE each existing row (guarded by `AND material_grade IS NULL`, so
-- this is a no-op if a row somehow already got corrected) to migration 590's
-- real, intended values -- not a new INSERT (would create a duplicate under
-- an identical name).
--
-- Two additional, genuine data-quality bugs found and fixed WHILE building
-- this migration, NOT invented here -- confirmed against the source
-- rawmetalusa.json AND real published references before touching:
--   * 'Generic Hastelloy C-276' / 'Generic Hastelloy X': source's own
--     YoungsModulus_MPa = 1149000 (=> 1149 GPa) is physically impossible (no
--     real metal exceeds ~1000 GPa) for BOTH rows -- corrected to 205 GPa,
--     the real, published Haynes International datasheet value for both
--     alloys at room temperature (haynesintl.com/wp-content/uploads/2024/08/
--     c-276.pdf and .../x-brochure.pdf).
--   * 'Generic Hastelloy X' additionally has source ShearStrength_MPa =
--     207000 -- also physically impossible (a modulus-scale number, not a
--     failure-stress value). No real, citable shear-STRENGTH figure (as
--     opposed to shear MODULUS, a different property -- Haynes publishes
--     rigidity modulus 77.6 GPa, not directly usable here) was found --
--     left NULL rather than guessed, same "no reliable single number, don't
--     invent one" convention migration 590 itself already established for
--     other rows (e.g. EN 10025-2 S235JR's tensile strength).
-- Every other one of the 35 rows was checked programmatically for the same
-- class of defect (TYS>UTS, elastic modulus outside a real-metal range,
-- shear implausibly exceeding UTS, invalid Poisson's ratio) and passed --
-- these two Hastelloy rows are the only other corruption found in this batch
-- beyond the already-known Brass/Copper/4140/A572/S235JR corrections
-- migration 590 itself already applied to its OWN successfully-landed rows.
--
-- Scope note: material_group is NOT touched by any statement below -- these
-- rows are already live and already correctly tagged 'Ferrous & Non-Ferrous'
-- (per migration 592's earlier retag of the whole import), consistent with
-- every sibling row. Only the fields migration 590 actually intended to set
-- are corrected.
-- ============================================================================

BEGIN;

UPDATE raw_materials SET
  material_grade = 'Aluminum, AA 1100',
  material_type = 'Aluminum',
  density_kg_m3 = 2700, density = 2.7,
  ultimate_tensile_strength = 128, yield_tensile_strength = 89, shearing_strength = 74.5,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 191.4, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.7,
  cost = 5.961, cost_usa = 5.961, currency = 'USD'
WHERE material = 'Generic Aluminum, AA 1100' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, AA 2219',
  material_type = 'Aluminum',
  density_kg_m3 = 3100, density = 3.1,
  ultimate_tensile_strength = 330, yield_tensile_strength = 239, shearing_strength = 195,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 6.499, cost_usa = 6.499, currency = 'USD'
WHERE material = 'Generic Aluminum, AA 2219' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, AA 3105',
  material_type = 'Aluminum',
  density_kg_m3 = 2800, density = 2.8,
  ultimate_tensile_strength = 180, yield_tensile_strength = 133, shearing_strength = 108.5,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 191.4, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.7,
  cost = 5.864, cost_usa = 5.864, currency = 'USD'
WHERE material = 'Generic Aluminum, AA 3105' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, AA 7003',
  material_type = 'Aluminum',
  density_kg_m3 = 2700, density = 2.7,
  ultimate_tensile_strength = 370, yield_tensile_strength = 305, shearing_strength = 227,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.32,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.71,
  cost = 5.726, cost_usa = 5.726, currency = 'USD'
WHERE material = 'Generic Aluminum, AA 7003' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 1050A',
  material_type = 'Aluminum',
  density_kg_m3 = 2700, density = 2.7,
  ultimate_tensile_strength = 120, yield_tensile_strength = 87, shearing_strength = 73,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 187, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.7,
  cost = 5.955, cost_usa = 5.955, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 1050A' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 2007',
  material_type = 'Aluminum',
  density_kg_m3 = 2850, density = 2.85,
  ultimate_tensile_strength = 405, yield_tensile_strength = 260, shearing_strength = 230,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.71,
  cost = 6.169, cost_usa = 6.169, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 2007' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 2017',
  material_type = 'Aluminum',
  density_kg_m3 = 2700, density = 2.7,
  ultimate_tensile_strength = 315, yield_tensile_strength = 170, shearing_strength = 276,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 6.217, cost_usa = 6.217, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 2017' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 2024',
  material_type = 'Aluminum',
  density_kg_m3 = 2770, density = 2.77,
  ultimate_tensile_strength = 375, yield_tensile_strength = 294, shearing_strength = 304,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 6.235, cost_usa = 6.235, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 2024' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 2030',
  material_type = 'Aluminum',
  density_kg_m3 = 2820, density = 2.82,
  ultimate_tensile_strength = 405, yield_tensile_strength = 260, shearing_strength = 230,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.71,
  cost = 6.168, cost_usa = 6.168, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 2030' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 3003',
  material_type = 'Aluminum',
  density_kg_m3 = 2730, density = 2.73,
  ultimate_tensile_strength = 152, yield_tensile_strength = 145, shearing_strength = 96.5,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 191.4, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.7,
  cost = 5.842, cost_usa = 5.842, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 3003' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 3103',
  material_type = 'Aluminum',
  density_kg_m3 = 2730, density = 2.73,
  ultimate_tensile_strength = 170, yield_tensile_strength = 120, shearing_strength = 97.5,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 191.4, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 5.835, cost_usa = 5.835, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 3103' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 5005A',
  material_type = 'Aluminum',
  density_kg_m3 = 2700, density = 2.7,
  ultimate_tensile_strength = 180, yield_tensile_strength = 127, shearing_strength = 108,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 191.4, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 5.904, cost_usa = 5.904, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 5005A' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 5019',
  material_type = 'Aluminum',
  density_kg_m3 = 2630, density = 2.63,
  ultimate_tensile_strength = 325, yield_tensile_strength = 215, shearing_strength = 195,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 191.4, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.7,
  cost = 5.663, cost_usa = 5.663, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 5019' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 5052',
  material_type = 'Aluminum',
  density_kg_m3 = 2680, density = 2.68,
  ultimate_tensile_strength = 228, yield_tensile_strength = 193, shearing_strength = 160,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.71,
  cost = 5.846, cost_usa = 5.846, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 5052' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 5083',
  material_type = 'Aluminum',
  density_kg_m3 = 2700, density = 2.7,
  ultimate_tensile_strength = 345, yield_tensile_strength = 240, shearing_strength = 206,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 5.755, cost_usa = 5.755, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 5083' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 5251',
  material_type = 'Aluminum',
  density_kg_m3 = 2680, density = 2.68,
  ultimate_tensile_strength = 230, yield_tensile_strength = 160, shearing_strength = 159,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 138, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.71,
  cost = 5.844, cost_usa = 5.844, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 5251' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 5454',
  material_type = 'Aluminum',
  density_kg_m3 = 2700, density = 2.7,
  ultimate_tensile_strength = 300, yield_tensile_strength = 195, shearing_strength = 165,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 230, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.71,
  cost = 5.816, cost_usa = 5.816, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 5454' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 5754',
  material_type = 'Aluminum',
  density_kg_m3 = 2750, density = 2.75,
  ultimate_tensile_strength = 270, yield_tensile_strength = 186, shearing_strength = 150,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 227, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.71,
  cost = 5.979, cost_usa = 5.979, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 5754' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 6012',
  material_type = 'Aluminum',
  density_kg_m3 = 2750, density = 2.75,
  ultimate_tensile_strength = 280, yield_tensile_strength = 190, shearing_strength = 227,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.71,
  cost = 5.818, cost_usa = 5.818, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 6012' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 6060',
  material_type = 'Aluminum',
  density_kg_m3 = 2700, density = 2.7,
  ultimate_tensile_strength = 180, yield_tensile_strength = 121, shearing_strength = 140,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 5.91, cost_usa = 5.91, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 6060' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 6082',
  material_type = 'Aluminum',
  density_kg_m3 = 2700, density = 2.7,
  ultimate_tensile_strength = 290, yield_tensile_strength = 178, shearing_strength = 210,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 5.819, cost_usa = 5.819, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 6082' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 7020',
  material_type = 'Aluminum',
  density_kg_m3 = 2770, density = 2.77,
  ultimate_tensile_strength = 290, yield_tensile_strength = 215, shearing_strength = 221,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 5.785, cost_usa = 5.785, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 7020' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 7022',
  material_type = 'Aluminum',
  density_kg_m3 = 2780, density = 2.78,
  ultimate_tensile_strength = 505, yield_tensile_strength = 344, shearing_strength = 344,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 5.789, cost_usa = 5.789, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 7022' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 7050',
  material_type = 'Aluminum',
  density_kg_m3 = 2700, density = 2.7,
  ultimate_tensile_strength = 525, yield_tensile_strength = 425, shearing_strength = 344,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 6.054, cost_usa = 6.054, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 7050' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Aluminum, ANSI 7075',
  material_type = 'Aluminum',
  density_kg_m3 = 2810, density = 2.81,
  ultimate_tensile_strength = 410, yield_tensile_strength = 320, shearing_strength = 371,
  hardness = 60, hardness_system = 'Brinell',
  elastic_modulus_gpa = 69, poisson_ratio = 0.33,
  strength_coeff_k_mpa = 341.1, strain_hardening_exponent_n = 0.22, lankford_coefficient_r = 0.71,
  cost = 5.831, cost_usa = 5.831, currency = 'USD'
WHERE material = 'Generic Aluminum, ANSI 7075' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Brass, UNS C36000',
  material_type = 'Brass',
  density_kg_m3 = 8200, density = 8.2,
  ultimate_tensile_strength = 430, yield_tensile_strength = 260, shearing_strength = 280,
  hardness = 200, hardness_system = 'Brinell',
  elastic_modulus_gpa = 115, poisson_ratio = 0.29,
  strength_coeff_k_mpa = 317, strain_hardening_exponent_n = 0.54, lankford_coefficient_r = 0.99,
  cost = 9.603, cost_usa = 9.603, currency = 'USD'
WHERE material = 'Generic Brass, UNS C36000' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'C60',
  material_type = 'Carbon Steel',
  density_kg_m3 = 7570, density = 7.57,
  ultimate_tensile_strength = 675, yield_tensile_strength = 480, shearing_strength = 543,
  hardness = 170, hardness_system = 'Brinell',
  elastic_modulus_gpa = 207, poisson_ratio = 0.21,
  strength_coeff_k_mpa = 543, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0,
  cost = 1.481, cost_usa = 1.481, currency = 'USD'
WHERE material = 'Generic C60' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'C60E',
  material_type = 'Carbon Steel',
  density_kg_m3 = 7895, density = 7.895,
  ultimate_tensile_strength = 665, yield_tensile_strength = 515, shearing_strength = 517.2,
  hardness = 170, hardness_system = 'Brinell',
  elastic_modulus_gpa = 207, poisson_ratio = 0.21,
  strength_coeff_k_mpa = 543, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0,
  cost = 1.651, cost_usa = 1.651, currency = 'USD'
WHERE material = 'Generic C60E' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Hastelloy C-276',
  material_type = 'Hastelloy',
  density_kg_m3 = 8890, density = 8.89,
  ultimate_tensile_strength = 471, yield_tensile_strength = 407, shearing_strength = 205,
  hardness = 275, hardness_system = 'Brinell',
  -- elastic_modulus_gpa corrected from source's corrupted 1149 (physically
  -- impossible -- no real metal exceeds ~1000 GPa) to the real, published
  -- Haynes International datasheet value: 205 GPa at room temperature.
  elastic_modulus_gpa = 205, poisson_ratio = 0.31,
  strength_coeff_k_mpa = 1149, strain_hardening_exponent_n = 0.14, lankford_coefficient_r = 1,
  cost = 28.193, cost_usa = 28.193, currency = 'USD'
WHERE material = 'Generic Hastelloy C-276' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Hastelloy X',
  material_type = 'Hastelloy',
  density_kg_m3 = 8220, density = 8.22,
  -- shearing_strength: source's 207000 MPa is physically impossible (that's
  -- a modulus-scale number, not a failure-stress value) -- no real, citable
  -- shear-STRENGTH (as opposed to shear MODULUS, a different property --
  -- Haynes lists rigidity modulus 77.6 GPa, not applicable here) figure was
  -- found; left NULL rather than guessed.
  ultimate_tensile_strength = 517.2, yield_tensile_strength = 407, shearing_strength = NULL,
  hardness = 200, hardness_system = 'Brinell',
  -- elastic_modulus_gpa corrected from source's corrupted 1149 to the real,
  -- published Haynes International datasheet value: 205 GPa at room temperature.
  elastic_modulus_gpa = 205, poisson_ratio = 0.31,
  strength_coeff_k_mpa = 1149, strain_hardening_exponent_n = 0.14, lankford_coefficient_r = 1,
  cost = 22.683, cost_usa = 22.683, currency = 'USD'
WHERE material = 'Generic Hastelloy X' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Inconel 625',
  material_type = 'Inconel',
  density_kg_m3 = 8440, density = 8.44,
  ultimate_tensile_strength = 1275, yield_tensile_strength = 1017, shearing_strength = 765,
  hardness = 195, hardness_system = 'Brinell',
  elastic_modulus_gpa = 207, poisson_ratio = 0.19,
  strength_coeff_k_mpa = 1235, strain_hardening_exponent_n = 0.19, lankford_coefficient_r = 1,
  cost = 21.243, cost_usa = 21.243, currency = 'USD'
WHERE material = 'Generic Inconel 625' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Inconel 718',
  material_type = 'Inconel',
  density_kg_m3 = 8190, density = 8.19,
  ultimate_tensile_strength = 1126, yield_tensile_strength = 1004, shearing_strength = 303,
  hardness = 350, hardness_system = 'Brinell',
  elastic_modulus_gpa = 200, poisson_ratio = 0.28,
  strength_coeff_k_mpa = 1426, strain_hardening_exponent_n = 0.5, lankford_coefficient_r = 1,
  cost = 15.123, cost_usa = 15.123, currency = 'USD'
WHERE material = 'Generic Inconel 718' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Stainless Steel, 15-5PH',
  material_type = 'Stainless Steel',
  density_kg_m3 = 7873, density = 7.873,
  ultimate_tensile_strength = 1150, yield_tensile_strength = 915, shearing_strength = 700,
  hardness = 330, hardness_system = 'Brinell',
  elastic_modulus_gpa = 200, poisson_ratio = 0.28,
  strength_coeff_k_mpa = 1426, strain_hardening_exponent_n = 0.5, lankford_coefficient_r = 1,
  cost = 3.42, cost_usa = 3.42, currency = 'USD'
WHERE material = 'Generic Stainless Steel, 15-5PH' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Stainless Steel, 17-4PH',
  material_type = 'Stainless Steel',
  density_kg_m3 = 7800, density = 7.8,
  ultimate_tensile_strength = 1335, yield_tensile_strength = 1145, shearing_strength = 801,
  hardness = 345, hardness_system = 'Brinell',
  elastic_modulus_gpa = 200, poisson_ratio = 0.28,
  strength_coeff_k_mpa = 1426, strain_hardening_exponent_n = 0.5, lankford_coefficient_r = 1,
  cost = 7.185, cost_usa = 7.185, currency = 'USD'
WHERE material = 'Generic Stainless Steel, 17-4PH' AND material_grade IS NULL;

UPDATE raw_materials SET
  material_grade = 'Steel, AISI 1035',
  material_type = 'Steel',
  density_kg_m3 = 7870, density = 7.87,
  ultimate_tensile_strength = 785, yield_tensile_strength = 530, shearing_strength = 540,
  hardness = 150, hardness_system = 'Brinell',
  elastic_modulus_gpa = 207, poisson_ratio = 0.29,
  strength_coeff_k_mpa = 543, strain_hardening_exponent_n = 0.21, lankford_coefficient_r = 0.99,
  cost = 1.479, cost_usa = 1.479, currency = 'USD'
WHERE material = 'Generic Steel, AISI 1035' AND material_grade IS NULL;

COMMIT;

-- Verification:
-- SELECT material, material_grade, ultimate_tensile_strength, elastic_modulus_gpa, shearing_strength, cost_usa
-- FROM raw_materials
-- WHERE material IN ('Generic Aluminum, AA 1100', 'Generic Hastelloy C-276', 'Generic Hastelloy X', 'Generic Steel, AISI 1035')
-- ORDER BY material;
-- Expect: every row has material_grade populated (non-null), Hastelloy rows show elastic_modulus_gpa=205 (not 1149), Hastelloy X shows shearing_strength=NULL.
--
-- SELECT count(*) FROM raw_materials
-- WHERE material ILIKE 'Generic %' AND material_grade IS NULL
--   AND material IN (35 names above);
-- Expect: 0 (all 35 corrected).
