# Forging Module HLD/LLD: Review Feedback

Reviewed: `docs/planning/FORGING_MODULE_HLD_LLD_ARCHITECTURE.md` (v1.0.0, Nov 2026)
Status of the doc: should be "Draft proposal", not "Engineering Architecture Standard".

The overall approach (CAD engine, pure cost engine, DB-held rates) fits the existing modules. The points below need fixing before build.

## A. Must fix: does not match the repo

1. **Migration path and number.** Doc: `backend/src/database/migrations/950_...`. Repo: `backend/migrations/`; 950-954 are taken. Next free number is 955.
2. **RLS function.** `auth.current_organization_id()` does not exist. Existing policies use `public.current_user_org_ids()`.
3. **Duplicate machine table.** `forging_machines` duplicates `mhr_records` (forging machines already seeded in migration 824). The doc itself says machines live in `mhr_records`. Reuse it.
4. **Lookup tables.** Other modules keep lookups in reference data and calculator JSON (`casting-reference`, `memory-reference-domains.json`). Do not add `forging_lookup_tables` without a reason.
5. **Wage rates.** The 6-region rates are hard-coded in the doc. They belong in `lhr_records`, with a named source.
6. **Silent defaults.** The code uses defaults (complexity 1.4, friction 0.35, 5% kerf). `hpdc-engine.ts` stops and names any missing input instead. Follow that rule.
7. **Pure engine.** The diagram has the engine reading the DB mid-calculation. Load data in a reference service first, then call the pure engine, as casting does.
8. **Reuse CAD code.** Use `shared/draft_angle_geometry.py` and `casting_geometry.py`; follow `docs/CAD_ENGINE_OCC_BINDING_STANDARDS.md`.
9. **Unverified stack claims.** Confirm "Next.js 14", Redis/Postgres job queue and pgTAP actually match the repo.

## B. Must fix: technical errors

1. **Energy formula units.** `E = 1.35·V·σ·ln(h0/h1)/1000` gives joules, not kJ. Needs `/1,000,000`.
2. **Flash too small.** The doc says flash is 10-25% of weight, but its own formulas give about 4% (100x100 mm part, 150,000 mm3: about 6,000 mm3 of flash). Material cost is under-predicted. Also reconcile the two flash-width definitions (3-6% of part width in 3.2, 3-5x thickness in 5.3).
3. **CAD extractor is a stub.** Projected area is `bbox x 0.785`, perimeter is `bbox x 1.15`. Press size depends on projected area, so this must be the true silhouette.
4. **Extractor gaps.** Face orientation is ignored. Only one axis is tested (text says three). Undercuts use surface normal only, not real visibility. Undercut threshold is -0.5 deg in code but -0.05 dot product in DFM-002.
5. **Die cost per part.** Doc divides by total volume. Use `ceil(volume / die life)` die sets plus redressing cost (die life is in section 5.4).
6. **Tonnage formula unvalidated.** Likely under-predicts real press picks. Test against real forging quotes.
7. **Standards citations.** S1-S4 complexity classes are probably DIN 7523 / EN 10243-1 (cut-offs near 0.63 / 0.32 / 0.16), not DIN 7526. Verify every standard, material table and figure.

## C. Gaps to specify

1. **Scope.** Six processes are listed but only closed-die hot is modelled. Open-die, cold heading and ring rolling have no flash or heating. Propose closed-die hot as the MVP.
2. **Missing formulas.** Heating, heat treatment, shot blasting, route selection (4.1) and the preforming rule (the dA/dx threshold) have none. Press cycle is a hard-coded 6-12 s range, not physics.
3. **Double counting.** Blocker and finisher steps may count the same press and crew twice.
4. **Missing cost items.** Setup and die-change time, rejection rate, overhead and profit, packaging and freight, CO2, and rate-table versioning so quotes are reproducible.
5. **Threshold conflicts.**
   - Fillets: 1.5-3 mm in 3.4, 2.0 in DFM-003, 3.5 in the recommendation.
   - Rib ratio: 4:1 in 3.4, 4.5:1 in DFM-004.
   - Thin web and high tonnage are BLOCKER. Consider WARNING for a costing tool.
6. **Schema.** Add write policies, indexes and CHECK constraints. Limit the `USING (true)` lookup policy to authenticated users.
7. **Cache.** Include the extractor version in the geometry-hash cache key.
8. **Acceptance targets.** "+/-3% of benchmark quote data" has no benchmark data. ±10-15% is realistic for should-cost. Build the cost engine on manual geometry input in parallel with the CAD work.

## D. Questions for the CTO

1. Is closed-die hot forging the first process to build?
2. Do we reuse `mhr_records` and `lhr_records`, or is there a reason for new tables?
3. Where does validation data come from (real supplier quotes)?
4. How will the extractor find the true parting line and projected area?
5. Which standards and tables do we trust, and who verifies them?
