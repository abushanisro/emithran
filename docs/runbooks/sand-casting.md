# Sand casting: operating the module

How the sand-casting analysis and costing run in production, what can go wrong, and what to do. Design and decisions: the sections of
`docs/ENGINEERING.md` and the comments at the top of each file under `backend/src/modules/sand-casting` and
`backend/src/modules/bom-items/costing/casting/sand`. The worker itself: `casting-worker/README.md`.

## What runs where

| Part | Where | Notes |
| --- | --- | --- |
| Casting analysis (draw axis, parting line, cores, wall thickness, draft, undercuts) | `casting-worker` container (C++ / OpenCASCADE), behind `cad-worker-host` | No network, no credentials, read-only root, non-root, memory and CPU limits, a deadline per job. One job at a time. |
| Queue and runner | Backend, `CastingAnalysisRunner` | Rows of `casting_analyses`; one analysis per file hash and configuration (a second request for the same file is answered by the first). |
| Costing (route, calculators, plant variables) | Backend, `bom-items/costing/casting/sand` | The calculators are database rows (migrations 956, 958, 959, 964); the reference data is staged in `machining_reference_data`. |
| Viewer, explorer, frozen costs | Web app, manufacturing-intelligence page | |

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `CASTING_WORKER_SOCKET` | unset | Path of the worker host's Unix socket (`/run/casting-worker/worker.sock` in `docker-compose.prod.yml`, profile `sand-casting`). **Unset: analyses are accepted and stay `queued`.** |
| `CASTING_ANALYSIS_RUNNER` | on | `off` switches the runner off on this instance (use it on every replica but one if you run several). |
| `CASTING_RETENTION_DAYS` | unset (off) | A positive whole number of days. Set: every 6 hours, analyses older than that which are failed, for a file the part no longer has, or from an earlier worker are removed (see Data). |
| `CASTING_WORKER_DEADLINE_MS` | 600000 | The longest one job may run; the host stops the worker after it (`deadline_exceeded`). |

## Health

`GET /api/health/ready` includes `casting_worker`:

- `{"configured": false}`: no socket configured, or the runner is off. Not a failure.
- `up`: the host accepted a connection (the host treats a connection that closes without a request as a health probe; a busy host is up).
- `down` with `reason` `unreachable` or `timeout`: the socket is missing or nothing listens. Readiness is for alerting, not for restarts: an outage
  pages someone, the API stays up, and requests queue.

Page on `casting_worker` down for more than a few minutes when `CASTING_WORKER_SOCKET` is set.

## Failure modes

| What you see | Cause | What to do |
| --- | --- | --- |
| Analyses stay `queued` | No socket configured, runner off, or the host is down | Check `/api/health/ready`; start the host (`docker compose -f docker-compose.prod.yml --profile sand-casting up -d casting-worker`); the queue drains by itself. |
| An analysis `running` for more than 15 minutes | The backend died mid-job | Nothing: the runner reclaims a `running` row older than 900 s and retries it (a few attempts). |
| `failed` with `deadline_exceeded` | The part took longer than `CASTING_WORKER_DEADLINE_MS` | Raise the deadline for a very large file, or analyse the part alone; the benchmark (`casting-worker/BENCHMARK.md`) is about 2 s a part, 2.5 s at 150 distinct parts in one file. |
| `failed` with `unreadable_step`, `no_solids` | The file is not a usable STEP solid (corrupt, open shell, a flat face) | Permanent: the user fixes the file. The message says which. |
| `failed` with `analysis_failed` | Anything else; `error_detail` has the first 500 characters | Look at the backend log line `casting analysis <id> ... failed` and the host's stderr. |
| The cost says `incomplete` | A route step has no machine, or a setting is missing (hot box settings, the drying time of a coating chosen) | The line is named a gap with its reasons; set the value in the Cost Guide, or add the machine in HR Rates. |
| Frozen cost refused: "route incomplete" | The route has a gap | Fix the gap first. |

## A database that is behind the code

The sand-casting tables and calculators come from migrations 955 (casting analyses), 957 (draw direction), 960 (draw direction bound to its geometry), 961 (a
part's own plant values), 962 (frozen costs), 956/958/959/964 (the calculators). A database missing them shows as 500s on the part page. Look at the backend
log: `Could not find the table 'public.<name>' in the schema cache` (PGRST205) names the missing table. Apply what is missing with
`cd backend && npm run db:migrate -- --env <env> --dry-run`, then without `--dry-run`.

The code tolerates the two newest optional tables (961, 962: no part values and no frozen costs are assumed) and the retired `process_routes` tables
(nothing to remove on a delete); it does not hide the others, because costing a sand-cast part without its analysis tables would be a wrong answer.

## Upgrading the worker

`CASTING_WORKER_VERSION` (`casting-analysis.types.ts`) is part of what identifies an analysis: a new worker version means every part is analysed
again the next time it is opened. Release steps:

1. Change the worker under `casting-worker/` (it is the only source); update `PROVENANCE.sha256` for the files changed.
2. Run `casting-worker/check.sh` (image build, unit tests, hand-worked results), `casting-worker/e2e.sh` (a real part through the real host and the
   backend client) and `casting-worker/accuracy.sh --synthetic`. CI runs the same.
3. Bump `CASTING_WORKER_VERSION`, run `node backend/scripts/sync-casting-contract.js` (the backend's copy of `result.schema.json`), run the backend tests.
4. A result field added within schema version 1 is optional in the schema, so results of earlier workers stay valid.

## Data

- **Tables:** `casting_analyses`, `casting_draw_directions`, `sand_variable_overrides` (a part's own plant values), `sand_cost_snapshots` (frozen
  costs). All have row-level security (an organization reads only its rows); the backend writes with the service role after an RLS read of the BOM
  item. Include them in backups with the rest of the schema.
- **Files:** each analysis stores its meshes under `casting-analyses/<organization>/<analysis>/` in the `bom-files` bucket. An analysis is a few
  hundred KB of result JSON plus a few hundred KB of GLB.
- **Retention is opt-in** (`CASTING_RETENTION_DAYS`; nothing is deleted on an assumed schedule). When set, an analysis older than that is removed if it
  `failed`, its BOM item's 3D file has been replaced, or an earlier worker made it (the part is analysed again when opened). Nothing else refers to an
  analysis: a frozen cost keeps its own copy of the summary, and an engineer's draw direction keeps a copy of the geometry it was chosen on. The files of a
  removed analysis are removed only when no remaining row points at the same `output_prefix` (a reused row points at the original's). Each pass handles 200
  analyses and writes a `casting_retention.pruned` audit event per organization. **Not covered:** deleting a BOM item removes its analysis rows by cascade
  but leaves their files; list `casting-analyses/<organization>/` in the bucket against `casting_analyses.output_prefix` to find them. Watch the growth
  either way: `SELECT count(*), pg_size_pretty(sum(pg_column_size(result))) FROM casting_analyses;` and the bucket prefix size.
- **Audit events:** `casting_analysis.requested`, `casting_analysis.failed`, `casting_retention.pruned`, `casting_draw_direction.set|cleared`, `sand_variable_override.set|cleared`,
  `sand_snapshot.created|reviewed`.

## Settings the plant owns (nothing is assumed)

Set in the part's Cost Guide; until set, the step that needs them is a named gap or is costed without them, and the route says which:
energy price, the hot box settings (core box temperature, cure temperature, cured depth), refractory coating (none unless chosen; then the drying
method and time, and the coating's price). Published guidance is shown beside each field. A part's own value for any plant variable is set in the
calculations panel (with a reason, audited) and never changes the shared data.

## Known limits

- The mould, gating and cores are drawn from the machine's flask and the designed gating as a drawing convention; there is no pouring basin, vents,
  riser necks or core prints in the data. Fill and solidification are not simulated.
- Refractory coating and core gluing are costed on the seeded "Default" work centre (migrations no longer write reference rows); the number of coats of a
  core is the plant default for the mould.
- The accuracy gate passes on a synthetic corpus only; a labelled corpus of real parts is needed before accuracy is claimed (`casting-worker/accuracy.sh`).
- Nobody has yet reviewed the visual features in a browser against real parts; do that on stage before relying on them.
