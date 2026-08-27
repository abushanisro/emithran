-- ============================================================================
-- Migration: Backfill fiber_laser power_kw from the Machine Library reference
--            export, for exact-name matches only
-- Purpose: lookup_coverage_gaps id 235/503 ("60 of ~100 catalog fiber_laser
--          machines have power_kw=NULL") is this reconciliation's biggest
--          open gap. This app has a standing rule against inferring power
--          from a machine's OWN name string (see project memory — the
--          Salvagnini 2kW-vs-6kW same-model-different-power mixup earlier
--          this session is why). The machine_library export (migration
--          505-508, 281 named real machines) is a genuinely INDEPENDENT,
--          authoritative source — not the same string we're trying to
--          verify — so an exact (case-insensitive) name match against its
--          26 "Fiber Laser Cutting Machine" entries is real, sourced
--          confirmation, not name-parsing.
--
--          15 distinct machine names matched exactly; 18 mhr_records rows
--          (some names exist at multiple locations) get their power_kw
--          filled in from the matched row's power_watts / 1000. For 14 of
--          the 15, the source's power_watts agrees with the digit already
--          in the machine's own name (e.g. "...6kW Fiber" -> 6000W) — pure
--          confirmation. For the 15th, it does NOT agree, and that
--          disagreement is exactly why the no-name-parsing rule exists:
--
--            "Salvagnini L3-40 3KW Fiber" / "Salvagnini L3-40 3kW Fiber"
--            (both spellings exist in mhr_records as separate rows — a
--            pre-existing case-variant duplicate in this app's own catalog,
--            NOT introduced or fixed here, flagged for separate cleanup) —
--            the source's matching "Salvagnini L3-40 3kW Fiber" entry gives
--            power_watts=4000, NOT 3000. The name says 3kW; the actual
--            reference spec says 4kW. Trusting the independent source over
--            the name, per the standing rule. This does NOT touch the
--            already-resolved, differently-named "Salvagnini L3-30 2KW
--            Fiber" (migration 491) or the un-addressed "Salvagnini L3-40
--            3KW Fiber" open item referenced in project memory as still
--            NULL prior to this migration — this migration is exactly that
--            fix.
--
--          Remaining ~42 NULL fiber_laser rows have no exact match in this
--          export (either a different model entirely, e.g. Trumpf/Cincinnati/
--          Danobat variants not in the 26-row export, or a name variant
--          close-but-not-exact — left NULL rather than fuzzy-matched).
-- Author: Principal Engineering Team
-- Date: 2026-08-20
-- Version: 1.0.0
-- ============================================================================

UPDATE mhr_records SET power_kw = 6.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Amada ENSIS-4020 AJ 6kW Fiber';
UPDATE mhr_records SET power_kw = 4.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Amada FOL-3015 AJ 4kW Fiber';
UPDATE mhr_records SET power_kw = 3.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Bystronic BySprint 4020 3kW Fiber';
UPDATE mhr_records SET power_kw = 6.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Bystronic BySprint 4020 6kW Fiber';
UPDATE mhr_records SET power_kw = 6.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Bystronic BySprint 6520 6kW Fiber';
UPDATE mhr_records SET power_kw = 10.0 WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Durma HD-F 3015 10kW Fiber';
UPDATE mhr_records SET power_kw = 4.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Durma HD-F 3015 4kW Fiber';
UPDATE mhr_records SET power_kw = 6.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Durma HD-F 3015 6kW Fiber';
UPDATE mhr_records SET power_kw = 8.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Durma HD-F 3015 8kW Fiber';
UPDATE mhr_records SET power_kw = 10.0 WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Mitsubishi 800 Series 3015 eX-F10 10kW Fiber';
UPDATE mhr_records SET power_kw = 8.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Mitsubishi 800 Series 3015 eX-F8 8kW Fiber';
UPDATE mhr_records SET power_kw = 6.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Mitsubishi 800 Series 3015 eXZ-F60 6kW Fiber';
UPDATE mhr_records SET power_kw = 3.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Mitsubishi ML 3015 sR-F30 3kW Fiber';

-- Name says 3kW; the independent reference spec says 4kW. Both spellings of
-- this machine's name exist in mhr_records (see header) -- both get the same
-- sourced correction.
UPDATE mhr_records SET power_kw = 4.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Salvagnini L3-40 3KW Fiber';
UPDATE mhr_records SET power_kw = 4.0  WHERE machine_class = 'fiber_laser' AND power_kw IS NULL AND machine_name = 'Salvagnini L3-40 3kW Fiber';
