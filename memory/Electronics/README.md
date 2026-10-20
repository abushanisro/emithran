# memory/Electronics: assembly reference data (format only)

The electronics engines (SMT, reflow, line setup, harness) cannot price anything until this data exists.
These files are the **format**. They contain headers only; the values are supplied from outside the repo.
Nothing here is estimated or filled in by the platform.

Validate any time: `cd backend && npm run check:electronics-memory` (header-only files pass).

## Row rules (every file)

- **`source_url`**: an http(s) link to the datasheet, standard, library or quote the number came from.
- **`source_date`**: ISO date (`YYYY-MM-DD`) the source was read or issued; not in the future.
- **`source_note`**: optional; use it for conditions the number depends on (board size, profile, lead type).
- A row missing its source is rejected. There is no "unknown source" value.
- Numbers are plain numbers in the unit the column name states (`_mm`, `_s`, `_min`, `_cph`, `_usd`).
  No ranges in one cell: a range is two columns (`_min` / `_max`) or two rows.
- Do not collapse a range to a midpoint to fit a single column.
- If a figure was measured on a bare-board fabrication machine, or for a different task than assembly,
  say so in `source_note`; the confirmation status of each engine input is reported by
  `GET /v1/api/electronics/reference-coverage`.
- `package_class` must be one of the contract vocabulary values (`ecad-engine/contract/schemas`):
  `chip_0402, chip_0603, chip_0805, chip_1206, sot, sod, qfn, htssop, dpak, smd_electrolytic`.
  A footprint that fits none of them stays out of the lookup (it is flagged for review, never forced into a class).

## Files

| File | One row is | Closes engine input(s) |
|---|---|---|
| `smt_placement_rates.csv` | a machine's rated (and optionally effective) placements per hour for one package class | `smt_placement.rated_cph`, `smt_placement.cph_derating` |
| `smt_machines.csv` | an SMT-line machine's economics, same columns as the `memory/PCBA/Machine` files | (rates for the machine-hour-rate resolver) |
| `reflow_ovens.csv` | an oven and profile with its conveyor speed range | `reflow.conveyor_speed` |
| `line_changeover.csv` | a line configuration's changeover and per-feeder load time | `setup.line_changeover`, `setup.feeder_load` |
| `harness_cut_strip.csv` | a cut and strip machine's cycle time for a gauge and length range | `harness_cut_strip.cycle_time` |
| `harness_crimp.csv` | a crimp machine and mode (`automatic` or `bench`) with cycle time and applicator price | `harness_crimp.cycle_time`, `harness_crimp.applicator_nre` |
| `package_class_lookup.csv` | one exact KiCad / IPC-7351 (or vendor) footprint name with its package class and mount type | (BOM ingest: footprint to package class, by exact name) |

Uniqueness: placement rates by machine + package class; ovens by machine + profile; cut/strip by machine + gauge and
length range; crimp by machine + mode; footprints by name + standard.

`package_class_lookup.csv`: an `smd` row needs a `package_class`; a `tht` row leaves it blank (through-hole parts
are priced from their joint count, `pin_count`, not from the SMT vocabulary).

## Not covered here (still written gaps)

Stencil print and SPI cycle times, assembly AOI rate, X-ray time, THT insertion time per lead type, selective and
wave solder, coat and potting rates, ICT and functional test times, V-score feed, seal, connector, sleeve, grommet,
splice, label and continuity-test times. They are listed, with what would close each, in
`backend/src/modules/electronics-costing/domain/reference/engine-inputs.ts`. Add a file here and to
`backend/scripts/lib/electronics-memory-format.js` when data for one arrives.

## Where it lands

Staging into the database follows the existing memory-folder pattern (a generated, idempotent migration per
domain, machine rows into `mhr_records` with `specs`). That migration is written after the data is supplied.
