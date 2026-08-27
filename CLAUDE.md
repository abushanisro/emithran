# eMithran — Project Guidance

## Product development strategy

eMithran is developed manufacturing-domain by manufacturing-domain, one at a time — not as a universal manufacturing framework built all at once.

**Current priority: Sheet Metal.**

The Sheet Metal domain must reach production readiness before work begins on the next manufacturing domain (Machining, then Injection Molding, in that order).

Production readiness means the full pipeline works **dynamically** across the domain's real scenarios, not through hard-coded per-scenario paths:

```
CAD / STEP
  → Geometry extraction
  → Feature extraction
  → Material + thickness
  → Operations
  → Process selection
  → Machine capability
  → Machine selection
  → DFM
  → Cycle/setup calculations
  → Material + labor + machine + tooling + consumables
  → Cost
  → Explainable calculation trace
```

Two parts (e.g. 3mm SS304 with 6 bends and 14 holes vs. 2mm AL5052 with 4 bends and 8 holes) must automatically produce different features, operations, process candidates, machine candidates, cycle times, costs, and DFM results — never a special case coded per part or per "scenario."

Do not optimize for passing predefined scenarios through hard-coded logic. The system must derive behavior from real inputs: geometry, material, thickness, detected features, resolvable operations, real process capabilities, real machine constraints, and real costing parameters. When a real input needed to derive behavior correctly doesn't exist yet (missing CAD capability, missing reference data, missing linkage between two subsystems), that is a capability gap to document and flag — not a value to fabricate or a threshold to guess just to make a check pass.

### Sheet Metal readiness checklist

**CAD**
- [x] STEP ingestion
- [x] thickness extraction
- [x] bend extraction
- [x] hole extraction
- [x] slot/other real features (cut_profile, extruded_flange, thin_web)
- [ ] bend-to-bend / bend-to-flange relationships (signed fold direction) — in progress
- [x] flat-pattern information (outline, area, K-factor/bend allowance)
- [ ] stable topology provenance (current face/edge identity is runtime-ordinal / geometric-match only, not stable across STEP regeneration)
- [ ] deterministic, versioned, normalized feature contract — in progress

**Process** (existence ≠ production readiness — each needs real operations, constraints, machine capabilities, and costing behavior, not just a taxonomy row)
- [x] Fiber Laser, Laser
- [ ] Plasma, Oxyfuel (no cost engine yet)
- [x] Waterjet
- [x] Turret Punching / Nibbling
- [x] Bend Brake
- [ ] 2/3/4 Roll Bending (taxonomy exists, no cost engine)
- [ ] Press/Forming family (Generic/Std/Tandem Press — taxonomy exists, unwired placeholders)
- [ ] Progressive Die

**Operations** — each process should resolve to its own real sub-operations dynamically (e.g. Fiber Laser → Profile Cut / Hole / Complex Hole / Bevel; Bend Brake → Straight Bend / Multi Bend / Form / Flange), not a flat undifferentiated cost per process.

**Machine** — each operation should answer a real capability question ("can machine X perform operation Y on material Z at thickness T?"), never `process_name == machine_name` string matching.
- [ ] 3 of 7 USA fiber_laser `mhr_records` rows have zero thickness/bed capability data (documented gap, not fabricated: real spec exists in staged reference data for 2 of the 3, but shaped as unlabeled generic thickness tiers with no material-family legend — see `laserThicknessLimit`'s doc comment, `machine-selection/selector.ts`). As of the P0.7 fail-closed fix, `isCapable` now correctly rejects these rows as NOT capable on thickness instead of assuming capable — the data gap still needs sourcing, but it no longer produces a false-positive quote. Needs the real tier legend sourced before the 2 machines with staged-but-unmapped data can be backfilled.

**Machine Economics** (new architecture initiative, 2026-08-22, not yet started) — `mhr_records` today flattens machine identity + capability + economics + provenance into one table, seeded by a mix of real imports, name-matched seed guesses, and generic class defaults with no way to tell them apart at the DB level (see the `capability_source` column, which is inconsistently populated). Planned direction (audit before implement, same discipline as every P0.x phase): separate reference/benchmark data, real Digital Factory machine identity, and shop-specific economics into distinct layers, with one authoritative `resolveMachineEconomics()` resolver (customer/shop override → Digital Factory actual rate → approved company benchmark → industry benchmark → generic fallback) instead of every consumer reading `mhr_records` columns directly. Quote/cost snapshots must keep remembering the resolved value at time of apply (mirrors the existing FX snapshot pattern) so a later rate change never silently changes a historical quote. `memory/sheetmetal/machine/machine_library.json` is reference/provenance data feeding this pipeline, not something a UI should read directly to auto-fill a form.

**DFM** — `dfm-scoring.service.ts` is the sole manufacturability-verdict authority (P0.3); UI surfaces consume its result, never re-derive their own threshold.
- [ ] DFM persistence/audit-trail (documented gap, not started: DFM has no storage layer at all today — every `GET /bom-items/:id/dfm-scores` call fully recomputes live from the item's current feature_graph/thickness/material and writes nothing back; no `dfm_scores` table, no rule-version stamp. This is fine as long as nothing needs "what did DFM say at time X" — only build real persistence + rule-versioning together, deliberately, if that requirement ever arrives.)
- [ ] `process-planning/page.tsx`'s `DEFAULT_DFM_FEATURES`/`DFMColorMesh` surface is fully disconnected from the one DFM authority above (P0.3, deferred) — a second, independent DFM-adjacent judgment exists on that page.

**Cost** — feature → operation → process → machine → parameters → time → rate → cost, with an explainable calculation trace, and no hard-coded per-part-scenario logic.

### Testing philosophy for readiness

Beyond unit tests, maintain a **Sheet Metal scenario matrix** — real material/thickness/geometry/process combinations, including combinations not explicitly coded for, to prove the engine derives behavior rather than pattern-matching known scenarios.

### Freezing a domain

Once Sheet Metal reaches this level of readiness:
1. Freeze the Sheet Metal v1 architecture and contracts (feature contract, operation model, process model, capability model, machine model, costing interfaces, calculation trace, test suite).
2. Preserve its regression/scenario suite.
3. Avoid unrelated refactors to frozen domains.
4. Begin the next domain (Machining) as its own separate vertical.
5. Reuse the proven *engineering philosophy* (CAD → features → DFM → operations → process → capability → machine → cost), not sheet-metal-specific assumptions — Machining and Injection Molding will have genuinely different feature/domain models (holes/pockets/slots/threads/tool-changes for Machining; parting lines/draft/wall thickness/gates/runners/cooling/tonnage for Injection Molding).

Only make changes to a frozen domain for a real production bug or a genuinely required new capability — not exploratory redesign.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
