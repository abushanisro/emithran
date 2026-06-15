import type { EngineeringBrief } from '../dto/engineering-brief.dto';
import type { CandidateSet } from '../dto/candidate-set.dto';
import type { DrawingDimension } from '../dto/drawing-brief.dto';

/**
 * Tightness score for a dimension — lower = tighter (gets prioritised
 * in the LLM prompt). Combines absolute bilateral tolerance (mm) with
 * ISO-class hints. Falls back to 1.0 (loose) when no tolerance present.
 */
function dimTightness(d: DrawingDimension): number {
  if (typeof d.upperTol === 'number' && typeof d.lowerTol === 'number') {
    return Math.max(Math.abs(d.upperTol), Math.abs(d.lowerTol));
  }
  if (typeof d.toleranceClass === 'string') {
    const c = d.toleranceClass.toLowerCase();
    if (/(h6|h7|h6|k6|js6|p6|g6)/.test(c)) return 0.013;
    if (/(h8|js7|k7|h7)/.test(c)) return 0.027;
    if (/(h9|js8|h8)/.test(c)) return 0.054;
    if (/it6/.test(c)) return 0.016;
    if (/it7/.test(c)) return 0.025;
    if (/it8/.test(c)) return 0.039;
    if (/it9/.test(c)) return 0.062;
  }
  return 1.0;
}

/**
 * System prompt for the AI Process Plan Generator.
 *
 * Three parts emitted as separate cacheable blocks:
 *   1. Static instructions    (stable across all calls — cached)
 *   2. CandidateSet section   (per-generation — also cached for the
 *                              session window so retries on validation
 *                              error hit cache)
 *   3. EngineeringBrief       (per-generation — not cached separately;
 *                              piggy-backs on the candidates block)
 *
 * Caching reduces input tokens by ~80–90% on retries.
 */

export const STATIC_SYSTEM_PROMPT = `You are a senior manufacturing process engineer for an Indian shop floor. You produce process plans for the Mithran platform.

# Your role

You are a PROCESS PLANNER. You select which operations to run, which machines to use, which labour band, and which calculator to assign. You do NOT compute costs — the platform's cost engines do that.

Timing fields (setupMin, cycleSec, setupManning) are OPTIONAL. Omit them if you have no confident estimate — the resolver will get timing from the assigned calculator (using part geometry) or fall back to safe defaults. Provide timing only when:
  - A LOOKUP TABLE row in the CANDIDATE SET gives exact shop-floor standards for this part.
  - You have strong engineering evidence tied to specific drawing data (e.g. known cycle for a specific hole diameter).

Providing wrong timing is worse than providing none. When in doubt, omit.

You MUST reference masters by their candidate ID (rm-1, mc-2, etc.). NEVER invent IDs. NEVER reference a candidate ID not present in the CANDIDATE SET.

You have two tools:
  - \`expand_candidates(kind, query)\` — ONE-SHOT widening per kind if the current candidates don't fit. Use sparingly (at most one call per kind).
  - \`save_draft(plan)\` — Final write. ENDS THE SESSION. Call exactly once when ready.

# Phase-1 scope rules

You only generate plans for cnc_turned, cnc_milled, and sheet_metal child parts. If the BRIEF.scope.family says \`out_of_scope\`, do NOT call save_draft — the platform will not invoke you in that case.

# MANDATORY OPERATIONS — you MUST include ALL of these

The brief includes a MANDATORY OPERATIONS list produced by the rule engine. Every op in that list MUST appear in your process plan. You are not allowed to skip or omit mandatory ops. For each mandatory op:
  - Use the suggestedOpNbr as your starting point (adjust ±5 to fit your sequence).
  - Find the best matching operation candidate from the CANDIDATE SET (or propose a new master if none fit).
  - Assign the best matching machine and labour band.
  - Assign a calculator via calculatorCandidateId if one is available.
  - Set featureId to the F-N id that triggered this op (e.g. "F1").
  - Write a reason citing the feature ID and what it represents.

# Machine selection by category

Each mandatory op carries a machine category hint. Match it strictly:

  bench_manual (Deburring, Cleaning, Marking, Packaging)
    → Find candidates: "bench", "workstation", "manual", "hand"
    → Rate: ₹50–200/hr
    → NEVER use a CNC lathe or machining centre for these ops
    → If no bench machine in the CANDIDATE SET: use the cheapest available machine,
      provide explicit cycleSec hint (deburring: 120–300 s for milled parts),
      AND add to your overall notes: "MACHINE GAP: Add Manual Workstation to MHR master (₹100/hr)"

  inspection_bench (Final Inspection, QC, Gauging)
    → Find candidates: "QC", "inspection", "gauge", "CMM", "bench"
    → Rate: ₹75–300/hr
    → NEVER use a CNC lathe for inspection
    → If no inspection machine exists: use cheapest available, provide cycleSec hint (final inspection: 300–600 s),
      AND note: "MACHINE GAP: Add Inspection Bench to MHR master (₹150/hr)"

  saw (Stock Cut, Sawing)
    → Find candidates: "band saw", "cold saw", "hacksaw"
    → If no saw: parting on CNC lathe is acceptable — state this in your reason

  heat_treatment
    → Furnace or vendor — use machine tagged 'heat_treatment' if present, else propose new master.

  surface_treatment (Anodize, Plate, Coat)
    → This is ALWAYS outsourced. Do NOT assign a VMC or CNC lathe.
    → If a surface_treatment machine exists in the CANDIDATE SET: use it.
    → If NO surface_treatment machine exists: add the operation as a PROCURED PART entry
      instead of a process line, with a reasonable vendor cost (e.g. Type III hardcoat
      anodize for a medium aluminium rail ≈ ₹80–₹250 per part depending on area).
      Set partName = "Surface Treatment — <spec from drawing>", supplierName = "Vendor TBD".

  cnc_lathe → turning center, CNC lathe, manual lathe
  cnc_mill  → VMC, HMC, machining centre, CNC mill
  any       → best available match from candidate set

# Complete process route

Build a complete route covering all manufacturing steps. Standard sequence:

  Op 10   Saw Cut / Stock Cut        — ALWAYS MANDATORY (bar stock always needs saw cut)
  Op 20   Face Turning               — ALWAYS for turned parts
  Op 30   OD Rough Turning           — ALWAYS for turned parts
  Op 35   OD Finish Turning          — if tightest tolerance ≤ 0.05 mm or Ra ≤ 1.6 μm
  Op 38   Shoulder / Flange Turning  — if SHOULDER_TURN or FLAT_FACE feature present
  Op 40   Drilling                   — MANDATORY if CROSS_HOLE or AXIAL_HOLE feature
  Op 45   Counterboring              — if COUNTERBORE feature
  Op 50   Tapping                    — if THREAD_INTERNAL feature
  Op 60   Deburring                  — ALWAYS MANDATORY for machined parts
  Op 65   Grinding                   — MANDATORY if GRIND feature (Ra ≤ 0.8 μm)
  Op 70   Heat Treatment             — MANDATORY if HEAT_TREAT feature
  Op 75   Surface Treatment          — MANDATORY if ANODIZE or PLATE feature
  Op 99   Final Inspection           — ALWAYS MANDATORY

For cnc_milled: face mill → pocket/contour mill → drill → tap → deburr → inspect.
For sheet_metal: laser cut → bend → deburr → inspect (+ weld / coat if features present).

# DFM mapping rubric

  - holeCount > 0      → at least one drilling op (check MANDATORY OPERATIONS first)
  - pocketCount > 0    → milling time scales with pocket count; rough + finish passes
  - thinWallCount > 0  → reduce feed; add inspection; warn in your reason
  - undercutCount > 0  → propose EDM or T-slot milling

# 2D DRAWING — authoritative source of truth

The drawing material field overrides the BOM material hint. Always use the drawing material for raw material selection when drawing is available.

Drawing extraction rules for process planning:

  - Tightest tolerance ≤ 0.02 mm → add finish op (precision turning or grinding)
  - Bore fit H6/H7 or position GD&T ≤ 0.02 → add reaming or boring after drilling
  - Concentricity / runout ≤ 0.05 → finish turn between centers; ≤ 0.01 → centerless grind
  - Perpendicularity / parallelism ≤ 0.05 → face grinding or precision finish-mill
  - Ra ≤ 0.4 μm → grinding, lapping (bore/ID), or honing
  - Ra ≤ 0.8 μm → fine grinding or precision finish-mill
  - Ra ≤ 1.6 μm → standard finish machining is sufficient
  - THREAD_INTERNAL (tapped holes, M4, M5, M6 etc.) → TAPPING op; cycleSec ≈ 30–90 s per tapped feature
  - THREAD_EXTERNAL (external threads on shafts, studs, M14×2 etc.) → THREAD MILLING op on VMC/HMC;
    cycleSec ≈ (thread_length_mm / pitch_mm) × 3 s — e.g. M14×2 × 20 mm thread = (20/2)×3 = 30 s,
    NOT the same formula as drilling. Never assign a drilling calculator to thread milling.
  - Counterbore → counterboring op after drilling
  - Heat treatment (Carburise / Nitride / Through-harden) → heat-treat op AFTER soft machining, BEFORE finish grinding
  - Hardness ≥ 30 HRC after heat-treat → finishing must use grinding

# Reason field MUST cite drawing evidence and feature IDs

Every line's reason must:
  - Cite the feature ID if triggered by a mandatory op (e.g. "F1 CROSS_HOLE Ø2.40mm THRU")
  - Cite drawing callouts where relevant ("drawing: Ra 0.4μm on bore wall")
  - Name the chosen candidate by name (not just ID)

Example: "F1 CROSS_HOLE Ø2.40mm THRU (drawing) — drilling on mc-1 CNC Lathe. Calculator cl-2 assigned for geometry-based timing."

If the drawing was not available, say so in your notes field and proceed from 3D + BOM metadata.

# Raw material rules

  - ALWAYS use the DFM volumeMm3 from the brief — NEVER recompute volume from bounding box dimensions yourself.
    When DFM source = "estimated from dimensions", the volumeMm3 already has a 0.45 fill factor applied for
    milled/pocketed parts. Use it as-is.
  - net_usage_kg = dfm.volumeMm3 × density_kg_per_m3 × 1e-9  (use candidate density, not your own assumption)
  - gross_usage_kg = net_usage_kg / (1 − scrap_fraction)
  - Scrap % FIXED values (do not vary):
      • CNC turning: 25%
      • CNC milling: 35%
      • Sheet metal: 12%
  - overhead % default: 5% for all raw material lines

# Process timing — provide only when confident

If a LOOKUP TABLE row matches this part exactly → read setupMin/cycleSec from that row, state which table/row in your reason.

Otherwise → OMIT setupMin/cycleSec entirely. The resolver will use the assigned calculator (geometry-based) or a safe fallback. Never hardcode generic timing tables in your reasoning — cycle time for Drill Ø2mm ≠ Drill Ø25mm, the calculator knows this.

# Batch size and operators

  - Batch size: ¼ of annual_volume for low-volume (<2000/yr), 100 for medium, 500 for high.
  - Heads: 1 for most ops, 2 for sheet metal bending and large mill setups.

# Tooling, logistics, procured parts

  - Tooling: EMPTY ARRAY. Do not generate. Costing engineer adds manually.
  - Logistics: EMPTY ARRAY. Do not generate. Costing engineer adds manually.
  - Procured parts: use for (a) bought-out sub-components in assemblies, AND (b) outsourced vendor
    services where no machine candidate exists (e.g. surface treatment, heat treatment vendor).
    For most machined child parts this will be empty unless surface treatment or HT is outsourced.

# When a master is missing

If no candidate in the CANDIDATE SET fits AND \`expand_candidates\` doesn't return one, propose a new master via \`proposedMasters[]\`, using engineering-defensible defaults. Reference it with \`proposedMasterId\`. The user will see "NEW MASTER" and decide whether to approve it.

# Hard constraints

  - Currency: INR throughout.
  - Tool calls: at most 4 total across the entire session. The orchestrator caps you at 4 — exceed and the session fails.
  - One \`save_draft\` call ends the session. Do not narrate after.

Be specific. Be concise. Be auditable.`;

/**
 * Format the per-call payload (brief + candidates). Returned as a string
 * blob to be sent as a user message — keeping it short and tabular helps
 * the model scan it quickly.
 */
export function formatBriefAndCandidates(brief: EngineeringBrief, candidates: CandidateSet): string {
  const lines: string[] = [];

  lines.push('# ENGINEERING BRIEF');
  lines.push('');
  lines.push(`Part: ${brief.bomItem.partNumber} — ${brief.bomItem.partName}`);
  lines.push(`Item type: ${brief.bomItem.itemType}`);
  lines.push(`Quantity per assembly: ${brief.bomItem.quantity} ${brief.bomItem.unit}`);
  lines.push(`Annual volume: ${brief.bomItem.annualVolume.toLocaleString('en-IN')} pcs/yr`);
  lines.push(`Unit weight: ${brief.bomItem.unitWeightKg} kg`);
  lines.push(`Dimensions (L×W×H): ${brief.bomItem.dimensions.lengthMm} × ${brief.bomItem.dimensions.widthMm} × ${brief.bomItem.dimensions.heightMm} mm`);
  lines.push(`Tolerance: ${brief.bomItem.tolerance ?? 'unspecified'}`);
  lines.push(`Surface finish: ${brief.bomItem.surfaceFinishRa ?? 'unspecified'}`);
  lines.push(`Heat treatment: ${brief.bomItem.heatTreatment ?? 'unspecified'}`);
  lines.push(`Hardness HRC: ${brief.bomItem.hardnessHrc ?? 'unspecified'}`);
  lines.push(`Material hint: ${brief.bomItem.materialHint ?? 'unspecified'}`);
  lines.push('');
  lines.push('## DFM');
  lines.push(`Volume: ${brief.dfm.volumeMm3.toFixed(0)} mm³ (${(brief.dfm.volumeMm3 / 1000).toFixed(1)} cm³)`);
  lines.push(`Surface area: ${brief.dfm.surfaceAreaMm2.toFixed(0)} mm²`);
  lines.push(`Bounding box: ${brief.dfm.boundingBox.lengthMm.toFixed(1)} × ${brief.dfm.boundingBox.widthMm.toFixed(1)} × ${brief.dfm.boundingBox.heightMm.toFixed(1)} mm`);
  lines.push(`Holes: ${brief.dfm.holeCount}, Pockets: ${brief.dfm.pocketCount}, Thin walls: ${brief.dfm.thinWallCount}, Undercuts: ${brief.dfm.undercutCount}`);
  lines.push(`DFM source: ${brief.dfm.fromCadEngine ? 'CAD engine (exact part volume)' : 'estimated from bounding-box × 0.45 fill factor — use volumeMm3 directly, do not recompute'}`);
  lines.push('');
  lines.push('## Context');
  lines.push(`Organization location: ${brief.context.organizationLocation}`);
  lines.push(`Currency: ${brief.context.currency}`);
  lines.push(`Phase-1 scope decision: family=${brief.scope.family}, confidence=${brief.scope.confidence}, reason="${brief.scope.reason}"`);

  // ── 2D drawing block (only if extracted) ──────────────────────────────────
  const dr = brief.drawing;
  if (dr.available) {
    lines.push('');
    lines.push('## 2D DRAWING EXTRACTION');
    lines.push(`Source: ${dr.source} (${dr.extractionModel ?? 'cached'})`);
    if (dr.drawingNumber) lines.push(`Drawing number: ${dr.drawingNumber}${dr.revision ? ' rev ' + dr.revision : ''}`);
    if (dr.title) lines.push(`Title: ${dr.title}`);
    if (dr.scale) lines.push(`Scale: ${dr.scale}`);
    if (dr.material) lines.push(`Material (drawing): ${dr.material}`);
    if (dr.heatTreatment) lines.push(`Heat treatment: ${dr.heatTreatment}`);
    if (dr.surfaceTreatment) lines.push(`Surface treatment: ${dr.surfaceTreatment}`);
    if (dr.hardness) lines.push(`Hardness: ${dr.hardness}`);
    if (dr.generalTolerance) lines.push(`General tolerance: ${dr.generalTolerance}`);
    if (dr.datums.length) lines.push(`Datums: ${dr.datums.map((d) => `${d.label}=${d.feature}`).join(', ')}`);

    if (dr.dimensions.length) {
      lines.push('');
      lines.push('Dimensions (top 20 by tightness):');
      const sortedDims = [...dr.dimensions]
        .map((d) => ({ d, tightness: dimTightness(d) }))
        .sort((a, b) => a.tightness - b.tightness)
        .slice(0, 20);
      for (const { d, tightness } of sortedDims) {
        const tol =
          d.upperTol != null && d.lowerTol != null
            ? ` ${d.upperTol >= 0 ? '+' : ''}${d.upperTol}/${d.lowerTol}`
            : d.toleranceClass
              ? ` ${d.toleranceClass}`
              : '';
        lines.push(`  ${d.balloon != null ? `[${d.balloon}] ` : ''}${d.label}: ${d.type === 'diameter' ? '⌀' : ''}${d.nominal}${d.unit}${tol}  (tightness ${tightness.toFixed(3)})`);
      }
    }

    if (dr.gdt.length) {
      lines.push('');
      lines.push('GD&T callouts:');
      for (const g of dr.gdt.slice(0, 15)) {
        const refs = g.datumRefs.length ? ` | ${g.datumRefs.join('-')}` : '';
        const mod = g.modifier ? ` ${g.modifier}` : '';
        lines.push(`  ${g.feature}: ${g.symbol} ⌖${g.tolerance}${mod}${refs}`);
      }
    }

    if (dr.surfaceFinishes.length) {
      lines.push('');
      lines.push('Surface finishes:');
      for (const s of dr.surfaceFinishes.slice(0, 10)) {
        const r = s.raMicrons != null ? `Ra ${s.raMicrons}μm` : '';
        const z = s.rzMicrons != null ? `Rz ${s.rzMicrons}μm` : '';
        lines.push(`  ${s.feature}: ${[r, z].filter(Boolean).join(' / ')}${s.directionSymbol ? ' ' + s.directionSymbol : ''}`);
      }
    }

    if (dr.threads.length) {
      lines.push('');
      lines.push(`Threads: ${dr.threads.map((t) => `${t.feature}: ${t.spec}`).join('; ')}`);
    }

    if (dr.holes.length) {
      lines.push('');
      lines.push('Holes:');
      for (const h of dr.holes.slice(0, 10)) {
        const depth = h.depth != null ? ` × ${h.depth}mm` : '';
        const through = h.throughHole ? ' THRU' : '';
        const cb = h.counterbore ? ` ↧ CBORE ⌀${h.counterbore.diameter}×${h.counterbore.depth}` : '';
        const cs = h.countersink ? ` ↧ CSK ⌀${h.countersink.diameter} @ ${h.countersink.angle}°` : '';
        lines.push(`  ${h.feature}: ⌀${h.diameter}${depth}${through}${cb}${cs}`);
      }
    }

    if (dr.notes.length) {
      lines.push('');
      lines.push(`Notes: ${dr.notes.slice(0, 5).join(' | ')}`);
    }
    if (dr.extractionWarnings.length) {
      lines.push(`Extraction warnings: ${dr.extractionWarnings.slice(0, 3).join(' | ')}`);
    }
  } else {
    lines.push('');
    lines.push('## 2D DRAWING EXTRACTION');
    lines.push('Not available (no 2D file uploaded or extraction failed). Plan from 3D + BOM metadata only and flag this in your notes.');
  }

  // ── Manufacturing Feature Graph ───────────────────────────────────────────
  if (brief.featureGraph && brief.featureGraph.features.length > 0) {
    lines.push('');
    lines.push('## MANUFACTURING FEATURES');
    lines.push(`(Overall confidence: ${(brief.featureGraph.overallConfidence * 100).toFixed(0)}% | Sources: ${brief.featureGraph.buildSources.join(', ')})`);
    for (const f of brief.featureGraph.features) {
      const geomParts: string[] = [];
      if (f.diameter != null) geomParts.push(`Ø${f.diameter}mm`);
      if (f.length != null) geomParts.push(`L${f.length}mm`);
      if (f.depth != null) geomParts.push(`depth ${f.depth}mm`);
      if (f.throughHole) geomParts.push('THRU');
      if (f.count != null && f.count > 1) geomParts.push(`×${f.count}`);
      if (f.spec) geomParts.push(f.spec);
      if (f.raMicrons != null) geomParts.push(`Ra ${f.raMicrons}μm`);
      const geomStr = geomParts.length > 0 ? ' — ' + geomParts.join(' ') : '';
      const conf = `conf=${(f.confidence * 100).toFixed(0)}%`;
      lines.push(`  ${f.id}: ${f.type}${geomStr} [${f.source}, ${conf}]`);
    }
  }

  // ── Mandatory ops from rule engine ────────────────────────────────────────
  if (brief.mandatoryOps && brief.mandatoryOps.length > 0) {
    lines.push('');
    lines.push('## MANDATORY OPERATIONS — you MUST include ALL of these in your plan');
    for (const op of brief.mandatoryOps) {
      const conf = `conf=${(op.confidence * 100).toFixed(0)}%`;
      const primaryHint = op.machineCategoryHint && op.machineCategoryHint !== 'any'
        ? op.machineCategoryHint : null;
      const altHints = op.alternativeMachineHints?.length
        ? op.alternativeMachineHints.join(' | ') : null;
      const machineHint = altHints
        ? ` | machine: ${altHints} (pick best from candidates)`
        : primaryHint ? ` | machine: ${primaryHint}` : '';
      lines.push(`  Op ~${op.suggestedOpNbr}: ${op.operationHint}  [${op.featureId}, ${conf}${machineHint}]`);
      lines.push(`    Rule: ${op.reason}`);
    }
  }

  lines.push('');
  lines.push('# CANDIDATE SET');
  lines.push('');
  lines.push('## Raw materials');
  for (const c of candidates.rawMaterials) {
    lines.push(`  ${c.candidateId}: ${c.material} (${c.grade ?? '—'}, density ${c.densityKgPerM3 ?? '—'} kg/m³, ₹${c.unitCostInrPerKg}/kg, location ${c.location ?? '—'}) [score ${c.score}]`);
  }
  lines.push('');
  lines.push('## Machines (MHR)');
  for (const c of candidates.machines) {
    lines.push(`  ${c.candidateId}: ${c.machineName} (${c.commodityCode ?? '—'}, ₹${c.rateInrPerHour}/hr, location ${c.location ?? '—'}) [score ${c.score}]`);
  }
  lines.push('');
  lines.push('## Labour bands (LSR)');
  for (const c of candidates.labour) {
    lines.push(`  ${c.candidateId}: ${c.labourType} (₹${c.lhrInrPerHour}/hr, location ${c.location ?? '—'}) [score ${c.score}]`);
  }
  lines.push('');
  lines.push('## Process operations (from user-configured process_calculator_mappings)');
  lines.push('  [Format: candidateId: Group › Route › Operation — these are the ONLY valid process choices]');
  lines.push('  [Always select from this list. Assign calculatorCandidateId when a calculator matches. Omit setupMin/cycleSec unless a lookup table row applies.]');
  for (const c of candidates.processes) {
    lines.push(`  ${c.candidateId}: ${c.processGroup} › ${c.processRoute} › ${c.operation} [score ${c.score}]`);
    if (c.referenceTables && c.referenceTables.length > 0) {
      for (const tbl of c.referenceTables) {
        lines.push(`    LOOKUP TABLE "${tbl.tableName}":`);
        if (tbl.rows && tbl.rows.length > 0) {
          const cols = tbl.columnDefinitions.length > 0
            ? tbl.columnDefinitions.map((col: any) => col.name ?? col)
            : Object.keys(tbl.rows[0]);
          lines.push(`      ${cols.join(' | ')}`);
          for (const row of tbl.rows.slice(0, 20)) {
            const vals = cols.map((col: string) => row[col] ?? '—');
            lines.push(`      ${vals.join(' | ')}`);
          }
        } else {
          lines.push('      (no rows)');
        }
      }
    }
  }
  lines.push('');
  lines.push('## Calculators');
  lines.push('  [Assign the best-matching calculator to each process line via calculatorCandidateId. The resolver executes it using MHR/LHR rates and part geometry — this makes cost deterministic across runs.]');
  for (const c of candidates.calculators) {
    const inputFields = c.fields.filter((f) => f.dataSource).map((f) => `${f.fieldName}(${f.dataSource})`).join(', ');
    lines.push(`  ${c.candidateId}: ${c.name} (${c.calcCategory}) — inputs: ${inputFields || 'manual'} [score ${c.score}]`);
  }

  lines.push('');
  lines.push('## Tooling (tc-N) — from your tooling cost records DB');
  if (candidates.tooling.length === 0) {
    lines.push('  [No tooling records found — leave tooling as empty array]');
  } else {
    lines.push('  [Use candidateId tc-N in save_draft. ALL cost data (unit cost, amortization, usage %) comes from the DB — do NOT invent values.]');
    for (const c of candidates.tooling) {
      const costStr = `₹${c.unitCostInr.toFixed(2)}/unit × ${c.quantity} × ${c.usagePercentage}% ÷ ${c.amortizationParts} pcs = ₹${c.costPerPart.toFixed(4)}/part`;
      const supplierStr = c.supplier ? ` | supplier: ${c.supplier}` : '';
      const customStr = c.isCustom ? ' [custom]' : '';
      lines.push(`  ${c.candidateId}: ${c.description} (${c.toolingType}${customStr}) — ${costStr}${supplierStr} [score ${c.score}]`);
    }
  }

  lines.push('');
  lines.push('# YOUR TASK');
  lines.push('');
  lines.push('Generate the complete process plan. Include ALL mandatory ops listed above plus any additional ops required by the part geometry, drawing callouts, and engineering judgment. Assign a calculator to every op where one is available. Omit timing fields unless a lookup table row applies. Reference candidates by symbolic ID only.');
  lines.push('');
  lines.push('When ready, call `save_draft` exactly once with the full AbstractPlan. Use `expand_candidates` first ONLY if a critical kind has no acceptable candidate.');

  return lines.join('\n');
}
