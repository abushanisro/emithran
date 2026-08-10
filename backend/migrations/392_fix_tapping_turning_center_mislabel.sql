-- ===================================================================================
-- Migration 392: Family-aware process identity resolution via applicable_families (2026-07-31)
--
-- Same root cause as migrations 388/390 (Shearning/Blanking mislabeled as
-- bending): bom-items.service.ts's resolveProcessIdentities() picked the
-- ACTIVE process_calculator_mappings row with the LOWEST display_order for a
-- given machine_class, with no way to know which route actually fits the
-- part being costed. machine_class='tapping' is done on sheet-metal, milled,
-- AND turned parts, and has 3 real, legitimate active rows for it:
--   Turning Center (display_order=120) -- correct for parts made on a lathe
--     with live tooling; WON by default, wrongly labelling a laser-cut/
--     press-braked sheet-metal bracket's tapped hole as lathe work.
--   Drilling       (display_order=133) -- correct for sheet-metal/milled parts
--   VMC            (display_order=151) -- correct for milled parts
--
-- Unlike the Shearning/Blanking case (no real distinct cost formula existed
-- for those labels at all -- they were simply wrong), all 3 tapping routes
-- ARE real and correct for the family they actually describe. Deactivating
-- two of them would just move the same bug elsewhere. The real fix: let the
-- catalog itself declare which part family each route applies to, via a new
-- applicable_families column -- editable through the existing
-- Calculators/Process admin UI, not a hardcoded mapping in application code.
-- resolveProcessIdentities() now prefers the row whose applicable_families
-- includes the part's family, falling back to the lowest-display_order row
-- (unchanged behaviour) when no row is scoped to that family.
--
-- Relabels EVERY existing saved row across ALL users that was mislabeled
-- before this fix existed -- scoped generally (no hardcoded row/item id), and
-- gated per-row on the owning bom_item's actual family so a genuinely
-- turned/mill-turn part's correctly-labelled "Turning Center" tapping row is
-- left untouched. Only sheet-metal and milled parts get relabelled.
-- ===================================================================================

ALTER TABLE process_calculator_mappings
  ADD COLUMN IF NOT EXISTS applicable_families TEXT[];

COMMENT ON COLUMN process_calculator_mappings.applicable_families IS
  'Part families (sheet_metal / cnc_milled / cnc_turned / mill_turn / injection_molded) this route applies to. NULL = generic/applies to any family. Used by resolveProcessIdentities() to pick the correct route when a machine_class has multiple legitimate routes for different part families.';

UPDATE process_calculator_mappings
SET applicable_families = ARRAY['cnc_turned', 'mill_turn']
WHERE machine_class = 'tapping' AND process_route = 'Turning Center';

UPDATE process_calculator_mappings
SET applicable_families = ARRAY['sheet_metal']
WHERE machine_class = 'tapping' AND process_route = 'Drilling';

UPDATE process_calculator_mappings
SET applicable_families = ARRAY['cnc_milled']
WHERE machine_class = 'tapping' AND process_route = 'VMC';

-- process_group is also currently 'Machining' on all 3 rows regardless of
-- family. That's correct for the Turning Center / VMC rows (genuinely
-- machined/turned parts use machining-skill labour throughout already), but
-- per explicit user decision, a sheet-metal part's tapping should show
-- process_group='Sheet Metal' -- the Drilling row is now exclusively scoped
-- to sheet_metal via applicable_families above, so this is safe to change
-- without affecting the cnc_milled (VMC) or cnc_turned/mill_turn (Turning
-- Center) rows.
UPDATE process_calculator_mappings
SET process_group = 'Sheet Metal'
WHERE machine_class = 'tapping' AND process_route = 'Drilling';

-- Sheet-metal parts: Turning Center -> Drilling / Sheet Metal
UPDATE process_cost_records r
SET process_route = 'Drilling',
    process_group = 'Sheet Metal'
FROM bom_items b
WHERE r.bom_item_id = b.id
  AND r.operation = 'Tapping'
  AND r.process_route = 'Turning Center'
  AND b.family_classification = 'sheet_metal';

-- Sheet-metal parts already relabelled to Drilling (e.g. by an earlier partial
-- run of this fix) still need process_group corrected to Sheet Metal.
UPDATE process_cost_records r
SET process_group = 'Sheet Metal'
FROM bom_items b
WHERE r.bom_item_id = b.id
  AND r.operation = 'Tapping'
  AND r.process_route = 'Drilling'
  AND b.family_classification = 'sheet_metal'
  AND r.process_group IS DISTINCT FROM 'Sheet Metal';

-- Milled parts: Turning Center -> VMC (process_group stays 'Machining' -- correct)
UPDATE process_cost_records r
SET process_route = 'VMC'
FROM bom_items b
WHERE r.bom_item_id = b.id
  AND r.operation = 'Tapping'
  AND r.process_route = 'Turning Center'
  AND b.family_classification = 'cnc_milled';

-- Turned/mill-turn parts: left as 'Turning Center' / 'Machining' -- correct as-is.
-- Any remaining 'Turning Center' rows belong to parts with no resolved
-- family_classification at all; left untouched rather than guessed.

-- Verification:
-- SELECT process_route, process_group, applicable_families, is_active
--   FROM process_calculator_mappings WHERE machine_class = 'tapping' ORDER BY display_order;
-- SELECT r.id, r.bom_item_id, b.family_classification, r.operation, r.process_route, r.process_group
--   FROM process_cost_records r JOIN bom_items b ON b.id = r.bom_item_id
--   WHERE r.operation = 'Tapping';
