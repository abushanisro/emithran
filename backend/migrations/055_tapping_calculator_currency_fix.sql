-- ============================================================================
-- Migration 055: Fix INR currency mislabeling + wrong hardcoded MHR/LHR
-- defaults on Machining - Tapping calculator (2026-08-02)
--
-- This calculator's MHR/LHR fields defaulted to a flat 91.6 / 96.14 labelled
-- "(INR/hr)" -- completely disconnected from this dialog's own real Applied
-- Rates ($40.00/hr machine, $46.67/hr labour for this part's actual selected
-- machine/location). The rest of the system consistently uses "$"/"$/hr"
-- (confirmed: e.g. calculator 4e738d77's "Direct Labor Rate /hr" -> $/hr,
-- "Setup Cost ($)" -> $) -- INR was leftover seed data from this
-- calculator's original authoring, not a deliberate alternate currency.
--
-- Same issue exists on Tool Cost / Tool Cost per Part / Machine Cost /
-- Labour Cost / Process Cost / Setup Cost / Total Process Cost on this same
-- calculator -- all relabelled to $ here too.
--
-- MHR/LHR default_value is set to NULL (not a corrected flat number) so it
-- ALWAYS comes from the process's real Applied Rates via the frontend's
-- generic bomFieldMapping (effectiveMachineRate/effectiveLaborRate) --
-- mirroring the same real-data-only convention Tap Diameter/Length/Cutting
-- Speed/Feed per Rev already use on this calculator (all default_value=NULL).
--
-- Scope note: a broader audit found 195 fields across 24 calculators total
-- still carry INR labelling/units system-wide -- out of scope here (only
-- this Tapping calculator was in front of the user); flagged separately.
-- ============================================================================

UPDATE calculator_fields SET display_label = 'MHR per Hour ($)', unit = '$/hr', default_value = NULL
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'MHR per Hour';

UPDATE calculator_fields SET display_label = 'LHR per Hour ($)', unit = '$/hr', default_value = NULL
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'LHR per Hour';

UPDATE calculator_fields SET display_label = 'Tool Cost ($)', unit = '$'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Tool Cost';

UPDATE calculator_fields SET display_label = 'Tool Cost/Part ($)', unit = '$'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Tool Cost per Part';

UPDATE calculator_fields SET display_label = 'Machine Cost ($)', unit = '$'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Machine Cost';

UPDATE calculator_fields SET display_label = 'Labour Cost ($)', unit = '$'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Labour Cost';

UPDATE calculator_fields SET display_label = 'Process Cost ($)', unit = '$'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Process Cost';

UPDATE calculator_fields SET display_label = 'Setup Cost ($)', unit = '$'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Setup Cost';

UPDATE calculator_fields SET display_label = 'Total Process Cost ($)', unit = '$'
WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' AND field_name = 'Total Process Cost';

-- Verification:
-- SELECT field_name, display_label, unit, default_value FROM calculator_fields
--   WHERE calculator_id = 'fe42139c-5675-4a82-94d5-7f2d440ae9bf' ORDER BY display_order;
