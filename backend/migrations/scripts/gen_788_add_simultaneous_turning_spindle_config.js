// ============================================================================
// Generator: Migration 788 — real spindle-config columns for mhr_records
//
// Promotes number_spindles + the real per-station index-cycle overhead
// fields (drum_index_time_s, transfer_time_s, stock_feed_time_s,
// speed_synchronization_time_s) from memory/machining/machine/
// simultaneous_turning_usa.csv into real mhr_records columns — same
// "promote to a real dedicated column when a real registered engine
// consumes it" precedent as cut_to_length_cycle_const_s (migration 724) and
// press_cycle_time_s (migration 608).
//
// Additive ALTER TABLE (nullable, every other machine class leaves these
// null) + a real UPDATE keyed on (machine_class, machine_name) for the 14
// real Simultaneous Turning rows staged by migrations 737/738. Idempotent —
// safe to re-run.
// ============================================================================

const fs = require('fs');
const path = require('path');

const CSV_FILE = path.join(__dirname, '../../../memory/machining/machine/simultaneous_turning_usa.csv');
const OUT_SQL = path.join(__dirname, '../788_add_simultaneous_turning_spindle_config.sql');

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = fields[i] ?? ''; });
    return row;
  });
}
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function sqlStr(v) { return `$str$${v}$str$`; }

const rows = parseCsv(fs.readFileSync(CSV_FILE, 'utf8'));

const updates = rows.map((r) => {
  return `UPDATE mhr_records SET
  number_spindles = ${Number(r['slide_configuration.number_spindles'])},
  drum_index_time_s = ${Number(r['time.drum_index_time_s'])},
  transfer_time_s = ${Number(r['time.transfer_time_s'])},
  stock_feed_time_s = ${Number(r['time.stock_feed_time_s'])},
  speed_synchronization_time_s = ${Number(r['time.speed_synchronization_time_s'])}
WHERE machine_class = 'simultaneous_turning' AND machine_name = ${sqlStr(r.name)};`;
}).join('\n');

const sql = `-- ============================================================================
-- Migration 788: Real spindle-config columns for mhr_records (2026-09-19)
--
-- Source: memory/machining/machine/simultaneous_turning_usa.csv. Generated
-- by gen_788_add_simultaneous_turning_spindle_config.js -- see that script's
-- header. Promotes real per-machine spindle count + index-cycle overhead
-- times (drum index / transfer / stock feed / speed sync) so
-- computeCNCTurnedCostSummary's real multi-station adjustment (Machining
-- Simultaneous Turning engine) can read them the same way every other real
-- per-machine field (press_cycle_time_s, cut_to_length_cycle_const_s, ...)
-- is already resolved through MachineCandidate/MHRRateInput.
--
-- Additive, nullable columns -- every other machine class leaves these
-- null (not zero, so a real capability check can tell "no real spindle
-- data" apart from "genuinely 1 spindle").
-- ============================================================================

BEGIN;

ALTER TABLE mhr_records
  ADD COLUMN IF NOT EXISTS number_spindles NUMERIC,
  ADD COLUMN IF NOT EXISTS drum_index_time_s NUMERIC,
  ADD COLUMN IF NOT EXISTS transfer_time_s NUMERIC,
  ADD COLUMN IF NOT EXISTS stock_feed_time_s NUMERIC,
  ADD COLUMN IF NOT EXISTS speed_synchronization_time_s NUMERIC;

-- ── Populate the 14 real Simultaneous Turning rows (migrations 737/738) ────
${updates}

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verification (run manually after, once 737/738 have also been run):
-- SELECT machine_name, number_spindles, drum_index_time_s FROM mhr_records
--   WHERE machine_class = 'simultaneous_turning' ORDER BY machine_name;
-- -- Expect 14 rows, number_spindles in {2,6,8}, drum_index_time_s real per row.
`;

fs.writeFileSync(OUT_SQL, sql, 'utf8');
console.log(`Wrote ${OUT_SQL} (${rows.length} machine updates)`);
