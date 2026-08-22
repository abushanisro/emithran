# Sheet Metal process taxonomy

This folder holds the raw Sheet Metal process/operation/feature reference
export, plus a generated `structured/` layer that decomposes it into fields a
script or migration can consume without re-parsing strings.

```
process_operations.json    raw — 391 compound "Process:Operation//Feature" strings (untouched, source-of-truth)
process_machine_data.json  raw — default {process_name, tool_shop_name, machine} per process (untouched)
build-taxonomy.mjs         regenerates everything in structured/ — run: node build-taxonomy.mjs
structured/
  processes.json                            one row per distinct process — roadmap status + route assignment
  process_routes.json                       the verified live Route -> [Operation] hierarchy, standalone
  operations.json                           one row per raw operation string, fully decomposed (CAD-feature layer)
  taxonomy_tree.json                        same data as operations.json, nested for browsing
  process_calculator_mapping_candidates.json candidates shaped for the live process_calculator_mappings table
```

There are two distinct, deliberately separate layers here — don't conflate them:
1. **CAD-feature layer** (`operations.json`, `taxonomy_tree.json`) — the fine-grained `process/operation/feature` decomposition of every raw compound string. The live app has no equivalent of this today.
2. **Process-hierarchy layer** (`processes.json`, `process_routes.json`, `process_calculator_mapping_candidates.json`) — mirrors the live `process_calculator_mappings` table's 3-level `process_group / process_route / operation` shape, where `operation` is a process/machine-route name like `"Bend Brake"`, **not** a CAD feature like `"StraightBend"`. An earlier version of this folder incorrectly used the raw process name as `process_route` and a CAD feature as `operation` — that was wrong; the live schema has no feature concept at all. Fixed 2026-08-22.

`structured/*.json` is generated — don't hand-edit it. Re-run `node
build-taxonomy.mjs` after changing either raw file; it only needs Node's
built-in `fs`/`path` (no `npm install`).

## Raw grammar

Every string in `process_operations.json` is:

```
Process:Level1[:Level2[:Level3...]]
```

`Process` is the first `:`-delimited token (no process name contains `:`).
Each `Level` after it is either a bare category label (`"Countersinking"`) or
`Operation//Feature` (`"Bending//StraightBend"`). The parser is purely
syntactic — it splits on `:` and `//` and does not guess what a multi-level
chain *means* (e.g. what "As Formed//CurvedSurface" chained after
"StraightBend" represents is a domain question, not something inferred here).

Two examples, both handled by the same code path:

```
"Bend Brake:Bending//StraightBend"
  -> process: "Bend Brake", levels: [{operation:"Bending", feature:"StraightBend"}]

"2 Roll Bending:2 Roll Bending//StraightBend:As Formed//CurvedSurface"
  -> process: "2 Roll Bending"
     levels: [{operation:"2 Roll Bending", feature:"StraightBend"},
              {operation:"As Formed", feature:"CurvedSurface"}]
     leaf_operation: "As Formed", leaf_feature: "CurvedSurface"
```

## `structured/processes.json`

One row per distinct process name (union of both raw files — includes `CTL`
and `User-Defined Process`, which appear only in `process_machine_data.json`
with zero operations).

| field | meaning |
|---|---|
| `process_name` | e.g. `"Bend Brake"` |
| `default_machine` | preferred machine name — an entry literally named `"Default …"` if one exists, else the first listed |
| `tool_shop_name` | tool shop name paired with `default_machine` |
| `machine_entries` | every `{tool_shop_name, machine}` row for this process in the raw file (some processes have more than one, e.g. `2 Axis Router`) |
| `operation_count` | how many rows in `operations.json` belong to this process |
| `roadmap_status` | `production \| thin \| unwired \| not_modeled \| non_mfg` |
| `status_note` | one-line reason, from the roadmap |
| `process_route` | the live category bucket this process belongs to (e.g. `"Bending/Floating /Forming"`), or `null` if unassigned |
| `route_match` | `exact \| alias_confident \| unassigned` — see below |

### `process_route` / `route_match` / `live_active` source

Every process is included — **nothing is dropped for being unwired, thin, or
not_modeled.** Combining the 2026-08-22 live screen (68 ops · 13 routes
reported, 64 transcribed) with a targeted read of the actual `INSERT`
statements in `backend/migrations/` (stronger evidence than a UI
transcription where the two disagree), 22 of the 24 processes now have route
evidence:

- **`exact`** (20): the process_name literally matches (case/spacing aside)
  a live operation name, or matches a real `INSERT` in migration history —
  e.g. Bend Brake, Laser Cut, Fiber Laser Cut, 2/3/4 Roll Bending, Deslag,
  Generic Press, Material Stock, No Cost Feature, OxyFuel Cut, Plasma Cut,
  Std Press, Tandem Press, Turret Press, 2 Axis Router, 3D Laser, Progressive
  Die (live: "Progressive die"), **Laser Punch** and **Plasma Punch** (both
  confirmed via migration 503's own INSERTs → `"Sheet Metal Fabrication"`,
  correcting an earlier guess/typo-alias for Laser Punch).
- **`alias_confident`** (2): same real-world process, a different string —
  `Waterjet Cut` (raw) vs. live `"Waterjet Cutting"`; `Shear` (raw) vs. live
  `"Shearing"`/`"Shearning"`.
- **`unassigned`** (2): **CTL, User-Defined Process** — confirmed via
  migration history to have no row in `process_calculator_mappings` at all
  (CTL and `Shear` only exist as `sm_reference_data` staging rows per
  migration 482 — `Shear` got an alias above via the UI screen's "Shearing"
  row, but CTL has no equivalent anywhere). `process_route: null` is
  deliberate — add a route to `ROUTE_ASSIGNMENT` in `build-taxonomy.mjs` only
  once confirmed, never by hand-editing `structured/processes.json`.

`live_active` mirrors whether that live row is active or inactive (`null`
when `route_match` is `unassigned`) — most routed processes are currently
inactive, which is expected: it's the roadmap's unwired/not_modeled tier
showing up as real (if inert) rows in the live schema.

**Corrections (2026-08-22):**
- The first pass of this route data wrongly aliased `Turret Press` to the
  live `"Turret Punching"` row. The fuller live screen showed they're two
  distinct rows — fixed to `Turret Press`'s own row under
  `Bending/Floating /Forming`.
- **Open question, unresolved:** migration history (024/051/368) shows
  `Turret Press` as an **active** row wired to a real calculator (`TPP
  Manufacturing`, id `a5d9b23a-5b8c-4d2b-98dd-3fa623458716`) — but the live UI
  screen shows an **inactive** `Turret Press` row. Migration files describe
  intent, not necessarily current live state, and this may be another
  case-duplication bug like Progressive Die's (see migration
  `440_backfill_case_duplicate_sheet_metal_mappings.sql`). `live_active:
  false` here reflects the UI screen, but this is flagged, not resolved — see
  the `OPEN QUESTION` comment above `ROUTE_ASSIGNMENT` in
  `build-taxonomy.mjs`. Don't build anything (e.g. a migration) that assumes
  either answer without checking the live table directly.

### Known duplicate/dirty rows on the live side

`process_routes.json`'s `known_duplicate_operations` records operation names
that appear more than once across routes on the live screen — real data
dirtiness (consistent with the roadmap's own note about a Progressive Die
case-duplication bug), not a transcription error here, and deliberately not
silently resolved: `Waterjet Cutting` (active under Cutting, also inactive
under Sheet Cutting), `Plasma Cutting`/`Plasma Cut`, `Shearing`/`Shearning`,
`3D Laser`/`3D Laser Cut`, `Fiber Laser Cut`/`Fiber laser Cutting`.

### `roadmap_status` source

Taken verbatim from Section 02 (Process coverage matrix) of the **Sheet Metal
v1 Production-Readiness Roadmap** (SM-ROADMAP-01), hardcoded in
`build-taxonomy.mjs`'s `ROADMAP_STATUS` table:

- **production** (5): Fiber Laser Cut, Laser Cut, Waterjet Cut, Turret Press, Bend Brake — dedicated, DB-wired cost engine.
- **thin** (4): 2/3/4 Roll Bending (substituted through a single-row Roll Forming calculator), Deslag (folded into generic deburring) — wired but not a real formula.
- **unwired** (9): 2 Axis Router, 3D Laser, Generic Press, Laser Punch, OxyFuel Cut, Plasma Cut, Plasma Punch, Std Press, Tandem Press — mapping row inactive, no cost path.
- **not_modeled** (3): CTL, Progressive Die, Shear — absent from `process_calculator_mappings` entirely (or deactivated).
- **non_mfg** (3): Material Stock, No Cost Feature, User-Defined Process — system markers, not manufacturing processes.

If the roadmap is later revised (e.g. an unwired process gets a real engine),
update `ROADMAP_STATUS` in `build-taxonomy.mjs` and rebuild — don't hand-edit
`structured/processes.json`.

## `structured/operations.json`

One row per raw string in `process_operations.json`:
`{raw, process, levels[], leaf_operation, leaf_feature, canonical_operation_reference}`.

`canonical_operation_reference` is filled in when `raw` exactly matches an
`operation_name` in `../lookuptable/operation_name_reference.json` (e.g.
several `Laser Cut`/`Fiber Laser Cut` raw variants all resolve to
`"Laser Cutting"`) — this reuses that existing lookup table instead of
re-deriving groupings, and is `null` when there's no exact match.

## `structured/taxonomy_tree.json`

The same rows as `operations.json`, nested as
`process -> operation -> feature (or "_none") -> operation -> feature -> ... -> {_raw: [...]}`
for browsing the taxonomy as a tree instead of a flat list.

## `structured/process_routes.json`

The verified ground-truth hierarchy, transcribed directly from the live
Process Calculator Mappings page's Sheet Metal group as rendered on
2026-08-22 (page header: "68 ops · 13 routes"; this transcription captures 64
operation rows across 13 routes — see `transcription_note` in the file
itself for why it doesn't reconcile to exactly 68):

```json
{
  "process_group": "Sheet Metal",
  "source": "live Process Calculator Mappings UI export (Sheet Metal group), captured 2026-08-22",
  "live_header_reported": "68 ops · 13 routes",
  "transcribed_op_count": 64,
  "routes": {
    "Bending/Floating /Forming": [
      { "operation": "Bend Brake", "active": true },
      { "operation": "Turret Press", "active": false },
      "..."
    ],
    "...": ["..."]
  },
  "known_duplicate_operations": [
    { "operation": "Waterjet Cutting", "occurrences": ["Sheet Cutting (inactive)", "Cutting (active)"] }
  ]
}
```

This is a transcription of a real screen, not a derived or guessed
structure — treat it as ground truth (including its `active` flags and its
duplicate/dirty rows). `ROUTE_ASSIGNMENT` in `build-taxonomy.mjs` maps raw
`process_name`s onto it (see above).

## `structured/process_calculator_mapping_candidates.json`

One row per process (all 24 — nothing dropped), shaped to match the **live**
`process_calculator_mappings` table:

```json
{
  "process_group": "Sheet Metal",
  "process_route": "Laser Cutting",
  "operation": "Fiber Laser Cut",
  "machine": "Laser Cutter - 4kW Fiber",
  "route_match": "exact",
  "live_active": true,
  "roadmap_status": "production"
}
```

For the 3 processes with `route_match: "unassigned"` (CTL, Plasma Punch,
User-Defined Process), `process_route` and `live_active` are `null`. This
deliberately does **not** invent `calculator_id` or `machine_class` —
assigning those is a human decision (the roadmap itself says picking the v1
process list "is not a decision made on your behalf") — so this file is a
*candidate* list for review, not an authoritative import.

## How this relates to the live app (context, not wired up)

Confirmed by reading the actual code (2026-08-21):

- **Nothing in `backend/src` reads any file under `memory/sheetmetal/` at
  runtime.** Every prior use of this reference export was a human manually
  transcribing values into a SQL migration (cited in comments) — this folder
  is offline staging data, not a live data source.
- The live process hierarchy is the `process_calculator_mappings` table:
  flat `process_group`, `process_route`, `operation` VARCHAR columns (no
  separate tables, no "feature" concept), plus `calculator_id`,
  `calculator_name`, `machine_class`, `is_active`, unique on
  `(process_group, process_route, operation)`.
- `sm_operation_reference_map` (migration 504: `process_group, process_route,
  operation, source_process_name`) is the existing live bridge from that
  hierarchy back to a raw "source process name."
- `sm_reference_data` rows keyed `processDefaultMachine:<name>` are the live,
  partially-seeded analog of `process_machine_data.json`.
- The Process Calculator Mappings page's "Download JSON" produces a richer
  shape than any of the above, but there is **no "Import JSON"** — only
  "Import Excel," which reads just 3 plain columns (Process Group / Process
  Route / Operation). There's no live path to bulk-push `calculator_id` or
  `machine_class` today.
- The cost engine's actual machine-selection code
  (`machine-capability.ts`, `machine-selection/selector.ts`, `physics.ts`) is
  fully decoupled from this compound-string convention — it works off a
  `MachineClass` enum and typed physical geometry, not process/operation/feature
  strings.
