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
| When to run it | **Apply Scenario**, as its first step (and the candidate-route "Apply Route"); the user never starts an analysis |

`ensureCurrent` is **idempotent** (it does no work when everything is current), **single flight per item** (a double click or two tabs share one run), and
fails the run only when the CAD analysis fails (nothing after it means anything without the features); a drawing that cannot be read or a casting worker
that refuses leaves the geometry analysis standing and the returned status says what is still missing. The frontend words the returned status
(`analysisNotReadyMessage`) and writes nothing until it is ready. The backend still refuses a route apply on an unanalysed part (409
`analysis_not_ready`), so a client that skips the run is stopped there.

`/reanalyze` and `/drawing-analyses` remain: a changed pull direction re-analyses the part, and both are used by the run.

## Removed

The Refresh Analysis button, its hook (`useRefreshAnalysis`), its pulse/arrow/stale-badge state (`isStale`, `needsFirstAnalysis`, the analysis-version query),
the page-only extractor-mismatch rule (`processNeedsReanalysis`), the `refreshing` prop threading, the "Re-analyse part" action of the CAD evidence panel,
and every text that told the user to press Refresh Analysis. `test/app/refresh-analysis-removed.test.ts` keeps it from coming back (the electronics module
is a different workflow with its own button and is not covered).

## Not done, and the follow-up

Apply Scenario's **writes** are still orchestrated by the browser (`applyScenarioNow`): commit the annual volume, patch `scenario_overrides`, save the
material grade, build the material-cost record from the engine's cost summary (price by location, usage, scrap), re-apply the route
(`route-applications`, which is already one atomic server-side replace), and refetch the cost summary. They are not one transaction: a failure midway
leaves the earlier writes in place, and the guards that prevent duplicates (`autoAddLock`, abort-on-failed-deactivate) live in the client.

The right next step is one backend operation, `POST /bom-items/:id/scenario-applications`, that owns that sequence behind the same `ensureCurrent`:
- **Request**: the staged scenario (location, routing mode and route, batch size, annual volume, production life, currency and ask price, material grade)
  and the `appliedRevision` the client saw.
- **State** (no migration needed to start): `scenario_overrides.appliedScenario = { revision, status: applying | applied | failed, appliedAt, analysisVersion, error }`,
  moved with a compare-and-set on `revision` (a PostgREST filter on the jsonb path), so two applies cannot interleave and a stale client gets 409.
- **Steps**, each idempotent so a retry converges: analysis, annual volume and material grade, one `merge_scenario_overrides`, material-cost snapshot (the
  logic now in `autoAddMaterialCost`, ported to a service next to the cost summary it reads), route apply (extract `applyRoute` from the controller into a
  service), then one cost-summary computation whose result is returned as the canonical response.
- **Failure**: the status is set to `failed` with the reason and the previous applied results stay; the frontend renders the returned state.
Cross-table atomicity would need a database function (the route replace already has one); the status-and-retry design above is the smaller step.
That move is a large change to a 2,300-line controller and a 1,000-line client sequence and deserves its own change with its own tests.
