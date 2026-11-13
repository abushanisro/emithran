# Apply Scenario and the part's analysis

## Root cause (why there were two buttons)

Applying a scenario writes a route and a material cost computed **from the part's analysis** (the CAD feature graph, the part family, and for a sand
casting the casting analysis). Nothing ran that analysis for the user: the backend derived the analysis status correctly and refused a route apply on an
unanalysed part, and the page turned that into "Run Refresh Analysis first" and held Apply back. The workflow was two manual steps, the first of which
was a separate, long, client-orchestrated job (`reanalyze`, then the drawing, then a status read, then the casting request, then five cache
invalidations). One more rule, "the chosen process needs a different CAD extractor than the stored features came from", existed only in the page, so the
page and the backend could disagree about whether the analysis was current.

State was not duplicated in the database: the analysis status is derived from what is stored (feature graph and its version, drawing, casting rows) and
cannot drift. The duplication was in **who decides and who runs it**.

## Architecture now

| Concern | Owner |
|---|---|
| Is the analysis current? (CAD features, drawing, casting; stale by engine version **or by the chosen process**) | backend `deriveAnalysisStatus` (`bom-items/analysis-status.ts`), served by `GET /bom-items/:id/analysis-status` |
| Make it current | backend `POST /bom-items/:id/analysis-runs` (`AnalysisRunService.ensureCurrent`): runs exactly what the status says is missing (CAD, then the drawing if there is a PDF, then the casting analysis once the family is known), nothing else |
| When to run it | **Refresh analysis** (top bar, `RefreshAnalysisButton`), the only place that starts one. Apply Scenario and Apply Route never do: on a part that is not analysed they point at Refresh analysis (`applyGate`, the button is highlighted) and the backend refuses them (409 `analysis_not_ready`) |

`ensureCurrent` is **idempotent** (it does no work when everything is current), **single flight per item** (a double click or two tabs share one run), and
fails the run only when the CAD analysis fails (nothing after it means anything without the features); a drawing that cannot be read or a casting worker
that refuses leaves the geometry analysis standing and the returned status says what is still missing. The button words the returned status
(`analysisRunMessage`). Both applies check the status with one rule (`RouteApplicationService.requireAnalysis`), so a client that skips the
button is stopped there.

`/reanalyze` and `/drawing-analyses` remain: a changed pull direction re-analyses the part, and both are used by the run.

## Decision 2026-11-13: an explicit Refresh analysis, Apply never analyses

Running the analysis inside Apply hid a long job (the CAD engine, then the casting worker) behind a button that says it applies a scenario, and Apply
then failed for analysis reasons. Now the user starts the analysis with **Refresh analysis** in the top bar, sees it run and finish, and Apply only
applies. What #204 removed stays removed: the client-orchestrated sequence, the page-only rules and the stale badges. The button calls the same one
backend run, and the status stays the backend's. `test/app/analysis-entry-point.test.ts` keeps the run to that one button.

## Apply Scenario as one backend operation (`POST /bom-items/:id/scenario-applications`)

`ScenarioApplicationService` is the single orchestration boundary and the only owner of the applied scenario's state:

1. the part must be analysed (`RouteApplicationService.requireAnalysis`); nothing is written, and the state is untouched, when it is not;
2. `begin_scenario_application` (migration 969), one statement under a row lock: one apply at a time per item, against the revision the caller saw
   (`409 scenario_revision_conflict`, `409 scenario_apply_in_progress`; an apply that began over 15 minutes ago and never finished may be taken over);
3. the scenario fields: annual volume and material grade on the item, every scenario key in one atomic `merge_scenario_overrides`;
4. the material cost record, a snapshot of the engine's own cost summary at this scenario (`MaterialCostSnapshotService`; kept when still right, else every
   active record is retired first and one is written);
5. the route (`RouteApplicationService`: the engine's recommendation, a chosen route, a Workflow Builder route, or the one already applied);
6. the machines picked in the Workflow Builder (a failure is reported, it does not undo the route);
7. the state: `applied` with revision + 1, or `failed` with the reason and the revision unchanged.

**State** is `scenario_overrides.appliedScenario = { revision, status: applying | applied | failed, startedAt, appliedAt | failedAt, error, analysisVersion }`.
No new table: it lives in the column that already holds the scenario, and only this service writes it (a patch that names the key is refused).

**Not one database transaction**: the writes go through the services that own them, over several tables (the route replace is already atomic in the database).
A failure midway keeps the earlier writes and says so (`failed` + the reason); every step is idempotent, so applying again converges. What can no longer happen:
the page showing "applied" over a refused route, two applies interleaving, a retry duplicating a record.

**Material price**: the browser used to price the record itself (a location-name match and a currency guess). It now takes the price from the one derivation the
cost-record service owns (regional column, currency conversion, a disclosed India fallback, currency provenance); only when raw_materials has no price does it
carry the engine's own price per kg. On the Back cover that changed the stored unit cost from 240 to 5.864 USD/kg for the same grade.

## Still to do

The page still runs its own write sequence (`applyScenarioNow`, about 1,000 lines). Switching it to this one call, and deleting that sequence (`autoAddMaterialCost`,
`reapplyExistingOrDefaultRoute`, `commitAnnualVolume`, the locks, the progress steps) is the next change. The old default-line route path (no route applied and
manual routing) is not carried over: `keep` falls back to the engine's recommendation and says so.
