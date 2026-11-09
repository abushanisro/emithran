# Forging Module: Claude Code Build Prompts

How to use this file
- One Claude Code session per phase, on its own branch (`forging/phase-N-...`). Paste the **Preamble** first, then the phase prompt.
- Start each session in plan mode. Read the plan. Only approve if you agree.
- Do not run two sessions that edit the same files at the same time.
- After each phase, run a fresh review session (prompt at the end) before merging.
- Inputs for the work: `docs/planning/FORGING_MODULE_HLD_LLD_ARCHITECTURE.md` (the draft) and `docs/planning/FORGING_MODULE_REVIEW_FEEDBACK.md` (the corrections). Where they disagree, the review feedback and the repo's real conventions win.

---

## Preamble (paste at the start of every session)

```
You are building the Forging costing domain for eMithran, one phase at a time.

Read first, before planning:
1. docs/ENGINEERING.md (platform architecture mandate, layering, engine registry, canonical feature vocabulary, environments)
2. docs/COSTING_AND_BOM_ARCHITECTURE.md
3. docs/planning/FORGING_MODULE_HLD_LLD_ARCHITECTURE.md and docs/planning/FORGING_MODULE_REVIEW_FEEDBACK.md
4. docs/ai-assisted-coding-guidelines.md
5. The closest existing domain, as the pattern to copy: backend/src/modules/bom-items/costing/casting/ (hpdc-engine.ts, hpdc-machine.ts, machine-choice.ts, casting-reference.service.ts) and costing/shared/core/ (engine-kernel.ts, manufacturing-process-registry.ts, manufacturing-process.types.ts).

Rules for the whole project:
- Follow the existing conventions over the draft doc. Match the surrounding code's naming, comment density and structure.
- Calculation engines are pure: no database or network calls. A reference service loads data first, then calls the engine.
- Never invent a number. Every rate, factor, threshold or standard value must come from the repo's reference data, a cited source, or me. If an input is missing, stop that line and report it as a named gap (like hpdc-engine.ts does). Do not substitute a silent default.
- Shared kernel files (cost-engine.ts, engine-kernel.ts, default-rates, shared DTOs) affect three live domains. Do not edit them without first telling me what else it affects.
- Migrations only go in backend/migrations (next free number is 955 or higher; check). Write them, but never apply them to stage or prd. Local Postgres only. The prod database is shared with dev, so only read-only queries against it, and only after I approve.
- Do not hand-edit generated files (reference-features.generated.ts and similar). Re-run the generator.
- Tests: every formula gets a test with a hand-calculated expected value. Show the arithmetic in a comment. Check units. Run the typecheck and the existing test runner for the folder you touched, and show me the results.
- Do not commit, push or open a PR unless I ask.
- If something needs a decision from me or the CTO (scope, a data source, a threshold, a migration, a change to shared code), stop and ask. List the options and give one recommendation.

Start in plan mode: show the plan, the files you will touch and the open questions. Wait for my approval before writing code.
```

---

## Phase 0: Fix the specification

```
Phase 0: revise the forging architecture document to v1.1. No code.

Goal: one correct document the CTO and I can build from.
Input: the draft HLD/LLD and FORGING_MODULE_REVIEW_FEEDBACK.md.

Do:
1. Create docs/planning/FORGING_MODULE_HLD_LLD_ARCHITECTURE_v1.1.md. Keep the original file unchanged.
2. Set status to "Draft proposal". Scope v1 to closed-die hot forging only; move the other five processes to a "Later phases" section.
3. Apply every item in sections A, B and C of the review feedback. For each, record in a change log at the end: what changed and why.
4. Align the document with the repo: real paths, real RLS helper (public.current_user_org_ids()), reuse of mhr_records and lhr_records, the engine registry, the canonical feature vocabulary, the physics-gap pattern. Check each claim against the code and say where you checked.
5. Resolve the contradictory thresholds (fillet, rib ratio, flash width) into one value each, and mark any value you cannot source as "NEEDS SOURCE".
6. Write the missing specs: heating, heat treatment, shot blast, route selection for closed-die hot, the preforming rule, die-sets-per-volume, setup/changeover, rejection rate, overhead and profit. Where a number needs a source, add it to a "Data needed" table (item, why, who provides it).
7. Add a section on validation: how the engine will be checked against real quotes, and a realistic accuracy target.

Do not touch any code. Done when: the v1.1 file exists, every review item is resolved or listed under "Open decisions", and the "Data needed" table is complete.
```

---

## Phase 1: Cost engine (manual geometry input)

```
Phase 1: build the closed-die hot forging cost engine, driven by hand-entered geometry. No CAD, no database changes.

Spec: docs/planning/FORGING_MODULE_HLD_LLD_ARCHITECTURE_v1.1.md (use the v1.1 file, not the original).
Location: backend/src/modules/bom-items/costing/forging/

Do:
1. Study how casting and injection molding specialise the kernel (ManufacturingProcessEngine, the registry, ProcessLineCost, CostSummaryDto, the physics-gap pattern). Reuse them. Do not create a parallel result shape.
2. Define the input types: geometry (volume, projected area, parting perimeter, bounding dimensions, complexity class), material, machine, quantities.
3. Implement pure functions, each in its own small file with its own tests:
   - gross billet weight (net + flash + scale + saw kerf + tong where applicable) and scrap credit
   - flash sizing, consistent with the v1.1 spec
   - press force, and blow energy with correct units
   - complexity class from volume ratio
   - machine selection: every capable machine is priced with its own rates, cheapest per part wins
   - route and cycle times, crew cost from the wage-grade mix, setup spread over the batch
   - die cost per part using die life, die sets needed, and redressing
   - DFM rules as data-driven rules with codes and severities
4. Register the engine in the process registry, but leave it OFF the default quote path.
5. Missing inputs become named physics gaps. No defaults.

Tests (jest, in the folder's existing style):
- At least 3 golden cases whose expected values I can verify by hand (a simple disc, a block, a flanged part). Show the arithmetic in comments.
- Edge cases: missing input, press too small for the part, zero draft, units.
- Run the backend typecheck and the costing tests; show the output.

Stop and ask me before: editing any shared kernel file, or choosing any rate or factor that has no source.
Done when: engine and tests pass, nothing outside costing/forging/ (and the registry entry) changed, and you list every gap and every assumption.
```

---

## Phase 2: Reference data and migrations

```
Phase 2: forging reference data, local only.

Spec: v1.1 document, "Data needed" table and the Phase 1 engine's input types.

Do:
1. Inspect the existing schema first: mhr_records, lhr_records, raw_materials, the casting reference tables, and migration 824 (forging MHR seeds). Reuse them. Only add a table where no existing one fits, and tell me why.
2. Read how reference data is separated from schema (npm run migrations:inventory and the on-premises notes in docs/ENGINEERING.md). Put schema changes and data in separate migrations, the way the repo does.
3. Write migrations numbered 955 or higher (check the folder). Use the repo's real RLS helpers and policy style: write policies as well as read, indexes, CHECK constraints for enums, foreign keys.
4. Seed only values that have a cited source. Anything else stays out and goes in a list for me.
5. Add a reference service (like casting-reference.service.ts) that loads the data and hands it to the pure engine.
6. Apply and test on local Postgres only (npm run local:up). Prove tenant isolation with a test: one organisation cannot read another's rows.

Never apply migrations to stage or prd. Stop and ask before any read of the shared database.
Done when: migrations apply cleanly on a fresh local database and on top of the baseline, the isolation test passes, and I have a list of unsourced values.
```

---

## Phase 3: CAD feature extractor

```
Phase 3: forging geometry extraction in cad-engine.

Spec: v1.1 document sections on parting line, projected area, draft, undercuts, ribs/webs, A(x).
Location: cad-engine/forging/

Read first: docs/CAD_ENGINE_OCC_BINDING_STANDARDS.md, cad-engine/die_casting/, cad-engine/shared/draft_angle_geometry.py, casting_geometry.py, feature_vocabulary.py, and the canonical vocabulary notes in docs/ENGINEERING.md.

Do:
1. Reuse existing shared geometry code. Do not copy it.
2. Compute real values, not bounding-box approximations: true projected area and parting perimeter from the silhouette, face orientation respected, curved faces sampled rather than judged at one midpoint.
3. Test the three principal axes and the best pull direction; return the choice and the score.
4. Detect undercuts by a real visibility test along the pull direction, not by normal alone. Use one consistent threshold.
5. Rib/web/fillet analysis and the cross-section curve A(x), with the thresholds from v1.1.
6. Output a versioned JSON payload that includes an extractor version (used in the geometry-hash cache key) and a JSON Schema the backend can consume. Follow the repo's feature-contract approach; do not hand-name feature types outside the canonical vocabulary. If forging needs new types, propose them and stop.
7. Do not wire it into the upload pipeline yet.

Tests (existing cad-engine test runner):
- Generated solids with known answers (box, cylinder, flanged disc, a part with a deliberate undercut). Expected area, perimeter and draft computed by hand.
- Check against any real STEP files I provide.

Stop and ask me for sample STEP parts before step 6 if none are in the repo.
Done when: tests pass, results on the known solids match hand values within a stated tolerance, and the output contract is documented.
```

---

## Phase 4: Integration, API, UI

```
Phase 4: connect the forging engine and extractor to the product.

Do:
1. First check the layering in docs/ENGINEERING.md and the platform architecture mandate against this change. List what could break in the other three live domains. Wait for my OK.
2. Connect extractor output to the engine input through the same path other domains use (feature graph, process selection, bom-items.service.ts). No special case for forging.
3. Version the stored result and use the existing cache and upload pipeline (cad-uploads). Do not add a new job queue.
4. Expose the result through existing DTOs. Regenerate the OpenAPI file with the repo's generator so the CI drift check passes.
5. Frontend: parting-plane and draft views and the cost-driver breakdown, following existing component and design conventions. Gate behind a feature flag that is off by default.
6. Add tests at each layer, including one end-to-end case from STEP to cost.

Stop and ask before any change to shared DTOs or kernel files.
Done when: typecheck, lint, backend tests, frontend tests and the OpenAPI check all pass, the flag is off by default, and the other domains' tests are unchanged.
```

---

## Phase 5: Validation and calibration

```
Phase 5: validate forging costs against real quotes.

I will give you real forging quotes or cost sheets with part geometry. Do not tune anything until I do.

Do:
1. Build a repeatable comparison script/test: for each quote, run the engine and report the per-line difference (material, machine, labor, tooling, total).
2. Produce a short report: where we are close, where we are off, the likely cause of each large gap.
3. Propose parameter changes as a list with the evidence for each. Do not apply them without my approval.
4. Use the repo's existing should-cost calibration mechanism where it fits; do not build a second one.
5. Write the QA checklist in the repo's QA format for me to run.

Done when: the report exists, every proposed change has evidence, and nothing was tuned without approval.
```

---

## Review prompt (fresh session after each phase)

```
Review the changes on this branch against docs/ENGINEERING.md, the v1.1 forging spec and docs/planning/FORGING_MODULE_REVIEW_FEEDBACK.md. Do not edit anything.
Check: any invented number or silent default; engine purity; unit errors; tests that pass without checking behaviour; edits to shared code that were not reported; migration safety and RLS; duplicated logic that already exists in the repo.
Report findings by severity, each with file, line and a concrete failure case.
```
