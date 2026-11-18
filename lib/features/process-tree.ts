import { type CostSummaryDto, type BOMItem } from '@/lib/api/hooks/useBOMItems';
import { type SecondaryProcessLine } from '@/lib/api/hooks/useSecondaryProcesses';
import { AS_SUPPLIED_STEP, asSuppliedOccurrences } from '@/lib/costing/two-model-view';
import { fmt, fmtInt, formatEstCycleTime } from '@/lib/features/display-format';
import { gdtCalloutNodes } from '@/lib/features/gdt-callout-nodes';
import { groupFeaturesByType } from '@/lib/features/machining-feature-tree';
import {
  familyToProcessGroupLabel,
} from '@/lib/features/process-group';
import { firstStepHoldsUnclaimedFeatures, isMachiningTreeFamily, showsCatalogOperations, showsStepTextRows, wholePartLabel } from '@/lib/features/process-tree-family';
import { sheetMetalOperationNodes, type OperationTreeNode } from '@/lib/features/sheet-metal-operation-nodes';
import type { FeatureGraph, FeatureGraphSummary, FeatureNodeV2 } from '@/lib/types/manufacturing';

export interface ProcessTreeNode {
  id: string;
  kind: 'part' | 'group' | 'operation' | 'feature';
  label: string;
  // The process an operation node stands for when its label is decorated
  // (e.g. "Melting — unresolved"): what vendor matching searches by.
  processName?: string;
  factory?: string;
  machine?: string;
  children?: ProcessTreeNode[];
  attrs?: { name: string; value: string }[];
  source?: string;
  // Set on hole-diameter-group feature nodes ("Ø1.6 × 24") so
  // computeFeatureNodeVisual can match this row to its v2Features occurrences
  // for highlighting — matching by diameter, not by parsing the display label.
  holeDiameterMm?: number;
  // Set on CNC canonical-operation feature nodes (built from real
  // feature_graph_v2 entries carrying a backend-attached canonical_operation —
  // see canonical-operation.ts) so a click can highlight the exact matching
  // feature_graph_v2 entry by id instead of re-deriving a match by label/diameter.
  v2FeatureId?: string;
  // Machining catalog-type nodes: the exact feature_graph_v2 ids they group.
  v2FeatureIds?: string[];
  // Sand casting's analysis features: each instance's faces on the 3D model (face_map face_ids), found
  // by the backend from the worker's face keys (casting-face-bridge.ts). They are not feature_graph_v2
  // entries, so v2FeatureIds cannot highlight them.
  faceOccurrences?: number[][];
  // Exact occurrences (feature_graph_v2 entry id + occurrence index) — one
  // machined instance of an entry, not every occurrence of it.
  v2Occurrences?: { featureId: string; occurrenceIndex: number }[];
  // A process that acts on the whole part surface (cleaning, NDT, packaging).
  wholePart?: boolean;
}

// Cast alloys that can never run a laser + press-brake route, however flat the
// geometry looks (ALBC bronze plate ≙ sheet steel to the geometric classifier).
// Mirrors backend isSheetFormableMaterial — keep the keyword lists in sync.
export const NON_SHEET_FORMABLE_RE = /BRONZE|ALBC|AL\.?\s?BR|CU\s?AL|C9[0-5]\d|GUNMETAL|LG[124]\b|CAST\s?IRON|FG\s?\d{3}|SG\s?IRON|EN-?GJ/i;

export function isSheetFormableMaterial(materialText: string): boolean {
  if (materialText.trim().length === 0) return true; // unknown → don't veto
  return !NON_SHEET_FORMABLE_RE.test(materialText);
}

export function resolveDisplayFamily(
  item: { materialGrade?: string | null; material?: string | null },
  fg: { classification?: { family?: string | null } } | null,
): string {
  // '' = the CAD engine did not classify this part. Never defaulted to
  // 'milled': that showed every unanalysed/unclassified part as Machining.
  const family = fg?.classification?.family ?? '';
  if (family !== 'sheet_metal') return family;
  return isSheetFormableMaterial(`${item.materialGrade ?? ''} ${item.material ?? ''}`)
    ? family
    : 'milled';
}

// CATEGORY-level label (the umbrella domain a CAD family belongs to — matches
// process_taxonomy.process_group, migration 733). 'Plastic Molding' covers
// all 4 real sibling processes (Injection/Compression/Reaction Injection/
// Structural Foam Molding) — deliberately different from familyLabel()'s
// 'Injection Moulded' below, which names the SPECIFIC process. Both are
// correct at their own grain; do not "fix" one to match the other.
// The part's process group for the Manufacturing Process tree: the Process
// the user chose (Create/Edit BOM Item or Cost Guide, persisted as
// scenario_overrides.processGroup), else the analysed family mapped through
// the one shared family->group table (lib/features/process-group.ts).
// Replaces a third hand-kept copy of that table here, which keyed die casting
// as 'casting' (never a CAD family) and turned parts as 'Turning' (no such
// process_group) — so every die-cast part showed "Unclassified".
export function resolveProcessGroupLabel(
  item: { scenarioOverrides?: Record<string, unknown> | null },
  family: string,
): string {
  const chosen = item.scenarioOverrides?.processGroup;
  if (typeof chosen === 'string' && chosen) return chosen;
  return familyToProcessGroupLabel(family) ?? 'Unclassified';
}

export function collectLeaves(node: ProcessTreeNode): ProcessTreeNode[] {
  if (!node.children?.length) return node.kind === 'feature' ? [node] : [];
  return node.children.flatMap(collectLeaves);
}

export function findNode(node: ProcessTreeNode, id: string): ProcessTreeNode | null {
  if (node.id === id) return node;
  for (const c of node.children ?? []) { const f = findNode(c, id); if (f) return f; }
  return null;
}

export function buildProcessTree(
  item: BOMItem,
  fg: FeatureGraph | null,
  summary: FeatureGraphSummary,
  factory: string,
  overrideProcesses?: string[],
  cost?: CostSummaryDto | null,
  materialDensityGcm3?: number | null,
  procRecords?: { opNbr?: number; category?: string; operation?: string; processGroup?: string; machineName?: string; machineClass?: string | null; isActive?: boolean }[] | null,
  secondaryLines?: SecondaryProcessLine[] | null,
): ProcessTreeNode {
  const family = resolveDisplayFamily(item, fg);
  const groupLabel = resolveProcessGroupLabel(item, family);
  // The process list is the APPLIED (or explicitly chosen) route, else the
  // cad-engine's own recommendations. Nothing is added to either.
  //
  // autoCompleteRoute used to augment whichever list arrived here, inventing
  // steps that were never applied and never recommended: an unconditional
  // "Fiber Laser Cutting" whenever no cutting process was present — a routing
  // decision the backend's route comparison exists to make — plus unconditional
  // Deburring and Inspection, and a Tapping step gated on its own heuristic
  // ("small holes in thin sheet") rather than on real thread features. That gate
  // disagreed with the backend, which requires threads.length > 0: confirmed
  // live, a part with NO thread features showed "Tapping / As Tapped / Potential
  // tapping features" in this tree while the costed route correctly had no
  // tapping at all. Two definitions of the same route, and this one was not the
  // one being quoted.
  // Real, confirmed live gap (2026-09-11): an injection-molded part with real,
  // manually-added Direct Process Costs (Mold Setup/Injection/Packing/Cooling/
  // Ejection/Inspections — all real cost.processLines) still showed a
  // completely empty Process Step tree (only the top-level part row, zero
  // operation children) — because fg?.processRecommendations is a Sheet-Metal-
  // shaped, cad-engine-computed recommendation list that is never populated
  // for this family, and no route had been explicitly applied/recommended
  // (overrideProcesses unset) even though real costed process lines already
  // existed. The exact same "cost lines as a real, already-computed process
  // list" fallback already exists elsewhere on this page (the Part/Complexity
  // summary card's routeFromCost) — reused here rather than reinvented, so the
  // tree reflects what was actually costed instead of showing nothing.
  const overrideRecs = overrideProcesses?.map((p) => ({ process: p, estimated_time_sec: null as number | null }));
  const fgRecs = fg?.processRecommendations;
  // Real, confirmed live gap (2026-09-11): once no route was ever "applied"
  // (only individual rows added via Add Process), this used to fall straight
  // through to `costRecs` below — the cost ENGINE's own hypothetical
  // recompute of every step it would run (including steps like "Material
  // Drying"/"Weight Check" that the user never actually added), each
  // re-matched to whichever machine the engine's OWN default selection
  // picked. That is a second, independent representation of "what this
  // part's process is" — confirmed live, it disagreed with Direct Process
  // Costs both on WHICH steps exist and on WHICH machine runs each one
  // (tree: "Arburg Allrounder 420 C..."; Direct Process Costs, from the
  // same item's real stored rows: "Netstal Synergy 1200"). Direct Process
  // Costs already settled this exact question for engine vs. stored data
  // (see the "engine rows shown only when no stored records exist" comment
  // at this file's DIRECT PROCESS COSTS section) — the tree must agree with
  // it, not maintain its own separate answer. `procRecords` (real
  // process_cost_records rows for this item) now takes priority over the
  // engine's own costRecs fallback whenever real stored rows exist.
  const storedRecs = procRecords?.length
    ? [...procRecords]
        .filter((r) => r.isActive !== false)
        .sort((a, b) => (a.opNbr ?? 0) - (b.opNbr ?? 0))
        .map((r) => ({
          process: r.category || r.operation || r.processGroup || 'Process',
          estimated_time_sec: null as number | null,
          // The machine class is the step's real identity: a saved row is named by its category or
          // operation ("Deburring"), its live cost line by the engine ("Finishing").
          machineClass: r.machineClass ?? null,
        }))
    : null;
  // Real machine actually recorded on the stored row for a given process
  // label — kept separate from `recs` itself (whose candidates come from
  // three structurally different sources with no common "machine" field)
  // so any path through the fallback chain below can still show the real
  // selected machine for a step that has one, instead of falling through to
  // the engine's own (possibly different) default-machine recompute.
  const storedMachineByProcess = new Map<string, string>();
  for (const r of procRecords ?? []) {
    if (r.isActive === false) continue;
    const label = r.category || r.operation || r.processGroup;
    if (label && r.machineName) storedMachineByProcess.set(label, r.machineName);
  }
  const costRecs = cost?.processLines?.length
    ? cost.processLines.map((l) => ({ process: l.process, estimated_time_sec: l.cycleTimeMin * 60 }))
    : null;
  // `?? []` alone would stop here the moment fgRecs is a real EMPTY array
  // (not null/undefined) — `??` only falls through on nullish, not on falsy
  // length — so each candidate is explicitly checked for real content before
  // falling through to the next.
  type TreeRec = { process: string; estimated_time_sec?: number | null; machineClass?: string | null };
  const recs: TreeRec[] = (overrideRecs && overrideRecs.length > 0 ? overrideRecs : null)
    ?? (storedRecs && storedRecs.length > 0 ? storedRecs : null)
    ?? (fgRecs && fgRecs.length > 0 ? fgRecs : null)
    ?? costRecs
    ?? [];

  // Machined families: every operation's features come from the backend's own
  // per-line featureIds (the operation sequencer). A line that reports none
  // yet (the turned path; Tapping) gets the part's unattributed features under
  // the part's first operation - the line that bills its machining - never a
  // frontend process-name-to-feature table. Which operation counts as
  // machining is decided by the part family, not by the step name containing
  // "Milling"/"Machining": that substring test skipped real steps such as
  // "4 Axis Mill", which is why they showed no features at all.
  const isMachiningFamily = isMachiningTreeFamily(family);
  // 2-Model Machining: the occurrences left as the source component made them are not machined (the backend costs only the rest). A
  // feature all of whose occurrences are as supplied leaves the machining steps; they are listed under their own step below.
  const asSupplied = cost?.sourceComponent ? asSuppliedOccurrences(fg, item.twoModelComparison?.result.as_supplied_face_ids) : [];
  const suppliedCount = new Map<string, number>();
  for (const o of asSupplied) suppliedCount.set(o.featureId, (suppliedCount.get(o.featureId) ?? 0) + 1);
  const v2All = (fg?.feature_graph_v2?.features ?? []).filter((f) => (suppliedCount.get(f.id) ?? 0) < f.occurrences.length);
  const v2ById = new Map(v2All.map((f) => [f.id, f]));
  // The cost line of a step: by the engine's name for it, else by machine class when exactly one line
  // runs on that class (a step saved as "Deburring" is the engine's "Finishing" line).
  const lineForRec = (rec: TreeRec) => {
    const lines = cost?.processLines ?? [];
    const byName = lines.find((l) => l.process === rec.process);
    if (byName || !rec.machineClass) return byName;
    const onClass = lines.filter((l) => l.machineClass === rec.machineClass);
    return onClass.length === 1 ? onClass[0] : undefined;
  };
  const claimedIds = new Set(
    recs.flatMap((r) => (lineForRec(r)?.featureBreakdown ?? []).flatMap((b) => b.featureIds ?? [])),
  );

  const featureLeaf = (idPrefix: string, f: FeatureNodeV2, machine: string, alone = false): ProcessTreeNode => {
    const occ = f.occurrences.length;
    const dia = f.diameter_mm != null ? ` Ø${f.diameter_mm.toFixed(1)}` : '';
    // "(default)" only tells variants apart; a type with a single feature has nothing to tell it from.
    const showVariant = !!f.variant && !(alone && f.variant === 'default');
    const variant = showVariant ? ` (${f.variant})` : '';
    return {
      id: `${idPrefix}_${f.id}`,
      kind: 'feature',
      label: `${f.canonical_operation ?? String(f.feature_type)}${variant}${dia} ×${occ}`,
      factory, machine,
      v2FeatureIds: [f.id],
      attrs: [
        { name: 'Feature', value: String(f.feature_type) },
        ...(showVariant ? [{ name: 'Variant', value: f.variant as string }] : []),
        ...(f.canonical_operation ? [{ name: 'Operation', value: f.canonical_operation }] : []),
        { name: 'Occurrences', value: String(occ) },
        ...(f.diameter_mm != null ? [{ name: 'Diameter', value: `${f.diameter_mm.toFixed(1)} mm` }] : []),
      ],
      // A feature with several occurrences (five curved walls, twelve planar faces) opens into one row per occurrence, each highlighting only
      // its own faces; the feature's row highlights them all.
      ...(occ > 1 ? { children: f.occurrences.map((o, i) => occurrenceLeaf(`${idPrefix}_${f.id}`, f, o, i, machine)) } : {}),
    };
  };
  // One occurrence of a feature: its own faces, and what was measured on it.
  const occurrenceLeaf = (idPrefix: string, f: FeatureNodeV2, o: FeatureNodeV2['occurrences'][number], i: number, machine: string): ProcessTreeNode => {
    const m = o as unknown as { diameter_mm?: number | null; depth_mm?: number | null; area_mm2?: number | null; length_mm?: number | null };
    const size = m.diameter_mm != null ? ` Ø${m.diameter_mm.toFixed(1)}` : '';
    return {
      id: `${idPrefix}_occ${i}`,
      kind: 'feature',
      label: `${String(f.feature_type)} ${i + 1}${size}`,
      factory, machine,
      v2Occurrences: [{ featureId: f.id, occurrenceIndex: i }],
      attrs: [
        { name: 'Feature', value: String(f.feature_type) },
        ...(m.diameter_mm != null ? [{ name: 'Diameter', value: `${m.diameter_mm.toFixed(2)} mm` }] : []),
        ...(m.depth_mm != null ? [{ name: 'Depth', value: `${m.depth_mm.toFixed(2)} mm` }] : []),
        ...(m.area_mm2 != null ? [{ name: 'Area', value: `${m.area_mm2.toFixed(1)} mm²` }] : []),
        ...(m.length_mm != null ? [{ name: 'Length', value: `${m.length_mm.toFixed(1)} mm` }] : []),
        { name: 'Faces', value: String(o.face_ids.length) },
      ],
    };
  };
  // Type group ("SimpleHole ×12") -> one row per real feature_graph_v2 entry.
  const typeGroupNodes = (idPrefix: string, features: FeatureNodeV2[], machine: string): ProcessTreeNode[] =>
    groupFeaturesByType(features).map((g) => {
      const members = g.variants.flatMap((v) => v.features);
      // One feature in the group: a child row would repeat the group row ("SharpEdge ×160" over "SharpEdge ×160"), so the group
      // row is that feature, with its own attributes.
      if (members.length === 1) {
        const only = featureLeaf(idPrefix, members[0]!, machine, true);
        return { ...only, id: `${idPrefix}_${g.type}`, label: `${g.type} ×${g.occurrenceCount}` };
      }
      return {
        id: `${idPrefix}_${g.type}`,
        kind: 'feature' as const,
        label: `${g.type} ×${g.occurrenceCount}`,
        factory, machine,
        v2FeatureIds: members.map((f) => f.id),
        attrs: [
          { name: 'Count', value: String(g.occurrenceCount) },
          ...g.variants.map((v) => ({ name: v.variant, value: `×${v.occurrenceCount}` })),
        ],
        children: members.map((f) => featureLeaf(`${idPrefix}_${g.type}`, f, machine)),
      };
    });

  const operations: ProcessTreeNode[] = recs.map((rec, opIdx) => {
    // Moulded-part geometry is PART-level: it belongs to the part's first
    // resolved operation, whatever the engineer named or however many steps
    // they added (exact-name gates on "Injection"/"Molding" silently dropped it).
    const isFirstOpForMolded = family === 'plastic_molded' && opIdx === 0;

    // Only the real machine: the stored row's own machine, else the live cost
    // line's DB-resolved machine, else '—'. Matched by exact process name.
    const matchedCostLine = lineForRec(rec);
    const machine = storedMachineByProcess.get(rec.process) ?? matchedCostLine?.machineName ?? '—';
    const breakdown = matchedCostLine?.featureBreakdown ?? [];
    const featureNodes: ProcessTreeNode[] = [];

    // Sheet metal: the catalog operations this step performs on the part's own
    // CAD features ("Punching // SimpleHole Ø4.0 ×14"), resolved by the backend.
    // Plastic molding: the same, from the recognised features and the molding process's catalog rows (backend plastic-catalog-operation-resolver.ts).
    if (showsCatalogOperations(family) && matchedCostLine?.catalogOperations?.length) {
      const withMachine = (n: OperationTreeNode): ProcessTreeNode =>
        ({ ...n, factory, machine, ...(n.children ? { children: n.children.map(withMachine) } : {}) });
      featureNodes.push(...sheetMetalOperationNodes(`catop_${opIdx}`, matchedCostLine.catalogOperations).map(withMachine));
    }

    // GD&T callouts this line covers (Inspection; family-agnostic — the
    // backend resolver serves both sheet-metal and machining parts alike).
    // Click-to-highlight the toleranced face uses the same v2FeatureIds
    // mechanism as every other node; a callout with no real face link (no
    // AP242 link on this part, or a drawing-sourced callout, which never has
    // one) renders the same way, just without a highlight on click.
    if (matchedCostLine?.gdtCallouts?.length) {
      featureNodes.push(...gdtCalloutNodes(`gdt_${opIdx}`, matchedCostLine.gdtCallouts).map((n) => ({ ...n, factory, machine })));
    }

    // A step that forms the part's shape (a forging's press or hammer, a powder metal compaction): every feature of the part's analysis, grouped
    // by type, each highlighting its faces.
    if (matchedCostLine?.formsPartFeatures && featureNodes.length === 0) {
      featureNodes.push(...typeGroupNodes(`formed_${opIdx}`, v2All, machine));
    }

    // Sheet metal steps show only the catalog operations above (the backend attaches them to every
    // line, live or applied). The earlier grouped-by-diameter hole and grouped-by-radius bend rows were a
    // second representation of the same CAD features and are gone.
    if (isMachiningFamily && (matchedCostLine?.featureOperations?.length ?? 0) > 0) {
      // Casting and machining: "Feature ×n", its catalog operation an attribute,, each listing the
      // feature instances it applies to (highlight exactly those).
      matchedCostLine!.featureOperations!.forEach((g, i) => {
        featureNodes.push({
          id: `castop_${opIdx}_${i}`,
          kind: 'feature',
          label: `${g.featureType} ×${g.instances.length}`,
          factory, machine,
          v2Occurrences: g.instances.filter((x) => x.featureId).map((x) => ({ featureId: x.featureId!, occurrenceIndex: x.occurrenceIndex })),
          attrs: [{ name: 'Operation', value: g.operation ?? 'Undetermined' }, { name: 'Why', value: g.reason }],
          children: g.instances.map((x, j) => ({
            id: `castop_${opIdx}_${i}_${j}`,
            kind: 'feature' as const,
            label: x.label,
            factory, machine,
            ...(x.featureId ? { v2Occurrences: [{ featureId: x.featureId, occurrenceIndex: x.occurrenceIndex }] } : {}),
          })),
        });
      });
    } else if (isMachiningFamily) {
      if (breakdown.some((b) => (b.occurrenceRefs ?? []).length > 0 || (b.faceIds ?? []).length > 0)) {
        // One row per entry, highlighting exactly what it acts on: machined feature instances ("Reaming // SimpleHole (SimpleHole:3)"),
        // tapped holes, the inspected holes, or the faces meeting at the sharp edges deburred (no feature lists those).
        breakdown.forEach((b, i) => {
          const refs = (b.occurrenceRefs ?? []).filter((r) => v2ById.get(r.featureId)?.occurrences[r.occurrenceIndex]);
          featureNodes.push({
            id: `machining_occ_${opIdx}_${i}`,
            kind: 'feature',
            label: b.name,
            factory, machine,
            ...(refs.length > 0 ? { v2Occurrences: refs } : (b.faceIds ?? []).length > 0 ? { faceOccurrences: [b.faceIds!] } : {}),
            attrs: [{ name: 'Time', value: formatEstCycleTime(b.timeSec) }],
          });
        });
      } else if (breakdown.some((b) => (b.featureIds ?? []).length > 0)) {
        // Real per-operation breakdown ("Spot Drill ×8", "Pocket Mill ×2", ...),
        // each row carrying the exact feature ids it machines and its real time.
        breakdown.forEach((b, i) => {
          const feats = (b.featureIds ?? []).map((id) => v2ById.get(id)).filter((f): f is FeatureNodeV2 => f != null);
          featureNodes.push({
            id: `machining_line_${opIdx}_${i}`,
            kind: 'feature',
            label: b.name,
            factory, machine,
            ...(feats.length > 0 ? { v2FeatureIds: feats.map((f) => f.id) } : {}),
            attrs: [
              { name: 'Count', value: String(b.count) },
              { name: 'Time', value: formatEstCycleTime(b.timeSec) },
            ],
            ...(feats.length > 0 ? { children: typeGroupNodes(`machining_type_${opIdx}_${i}`, feats, machine) } : {}),
          });
        });
      } else if (opIdx === 0 && firstStepHoldsUnclaimedFeatures(family)) {
        const unclaimed = v2All.filter((f) => !claimedIds.has(f.id));
        featureNodes.push(...typeGroupNodes(`machining_type_${opIdx}`, unclaimed, machine));
      }
    } else if (isFirstOpForMolded) {
      const wall = summary.wallThicknessNominalMm ?? null;
      const wallMin = summary.wallThicknessMinMm;
      const wallMax = summary.wallThicknessMaxMm;
      const bossCount = summary.holeOrBossCount ?? 0;
      const ribCount = summary.ribCount ?? summary.ribCountProxy ?? 0;
      const volMm3 = (item.volume as number | null | undefined) ?? 0;
      // Real density for this item's own grade (useMaterialDensity); '—' until resolved.
      const densityGcm3 = materialDensityGcm3 ?? null;
      const massG = volMm3 > 0 && densityGcm3 != null ? Math.round((volMm3 / 1e3) * densityGcm3 * 10) / 10 : 0;
      const undercutCount = summary.undercutFaceCount ?? 0;
      const undraftedCount = summary.undraftedFaceCount ?? 0;
      const avgDraftDeg = summary.avgDraftAngleDeg ?? null;
      const partingComplexity = summary.partingComplexity ?? null;

      featureNodes.push({
        id: 'feat_im_part', kind: 'feature', label: 'Moulded Part',
        factory, machine,
        attrs: [
          { name: 'Volume',    value: volMm3 > 0 ? `${fmtInt(volMm3)} mm³` : '—' },
          { name: 'Est. mass', value: massG > 0 ? `${massG} g (net part)` : '—' },
          ...(wall != null ? [{ name: 'Wall nom.', value: `${fmt(wall, 1)} mm` }] : []),
          ...(wallMin != null && wallMax != null
            ? [{ name: 'Wall range', value: `${fmt(wallMin, 1)} – ${fmt(wallMax, 1)} mm` }]
            : []),
          ...(partingComplexity != null ? [{ name: 'Parting complexity', value: `${Math.round(partingComplexity * 100)}%` }] : []),
          ...(bossCount > 0 ? [{ name: 'Bosses / holes', value: String(bossCount) }] : []),
          ...(ribCount > 0  ? [{ name: 'Ribs (detected)', value: String(ribCount) }] : []),
        ],
      });

      // ── DFM feature nodes — clickable → 3D face highlighting ─────────────
      if (undercutCount > 0) {
        featureNodes.push({
          id: 'feat_im_undercut', kind: 'feature', label: `Undercuts (${undercutCount} face${undercutCount > 1 ? 's' : ''})`,
          factory, machine,
          attrs: [
            // Classification rule (cad-engine/injection_molding/feature_extractor.py's
            // UNDERCUT_NEG_DOT_THRESHOLD), not a per-part measurement — every face
            // counted above already exceeds this by construction.
            { name: 'Classification', value: 'Back-angle >5° opposing pull direction' },
            { name: 'Action', value: 'Click to highlight in 3D viewer' },
          ],
        });
      }
      if (undraftedCount > 0) {
        featureNodes.push({
          id: 'feat_im_undrafted', kind: 'feature', label: `Undrafted Faces (${undraftedCount})`,
          factory, machine,
          attrs: [
            // Classification rule (UNDRAFTED_ABS_DOT_THRESHOLD), not a per-part
            // measurement — paired with the part's own real average draft angle
            // below when the CAD engine resolved one (avg_draft_angle_deg).
            { name: 'Classification', value: 'Draft angle <0.3°' },
            ...(avgDraftDeg != null ? [{ name: 'Part avg. draft angle', value: `${fmt(avgDraftDeg, 2)}°` }] : []),
            { name: 'Action', value: 'Click to highlight in 3D viewer' },
          ],
        });
      }
    }

    // A step that acts on the whole part (a sand casting's melting, pouring, cooling, ...): the part is its feature, highlighted whole.
    if (featureNodes.length === 0 && matchedCostLine?.actsOnWholePart) {
      featureNodes.push({ id: `whole_part_${opIdx}`, kind: 'feature', label: wholePartLabel(family), factory, machine, wholePart: true });
    }

    // A secondary process (CMM, cleaning, NDT, packaging): what it acts on, from
    // the secondary-process engine's own result for this step.
    const secondary = featureNodes.length === 0
      ? secondaryLines?.find((l) => l.process === rec.process && l.status === 'costed')
      : undefined;
    if (secondary) {
      const feats = secondary.featureIds.map((id) => v2ById.get(id)).filter((f): f is FeatureNodeV2 => f != null);
      if (feats.length > 0) featureNodes.push(...typeGroupNodes(`secfeat_${opIdx}`, feats, machine));
      else if (secondary.highlight === 'whole_part') {
        featureNodes.push({
          id: `secondary_part_${opIdx}`, kind: 'feature', label: 'Whole part surface', factory, machine, wholePart: true,
          attrs: secondary.trace.map((t) => ({ name: t.label, value: `${t.value}${t.unit ? ` ${t.unit}` : ''}` })),
        });
      }
    }

    // Any step not covered above: its own cost line's feature breakdown, as is.
    if (featureNodes.length === 0 && breakdown.length > 0 && showsStepTextRows(family)) {
      breakdown.forEach((b, i) => {
        const ids = (b.featureIds ?? []).filter((id) => v2ById.has(id));
        featureNodes.push({
          id: `line_${opIdx}_${i}`,
          kind: 'feature',
          label: b.name,
          factory, machine,
          ...(ids.length > 0 ? { v2FeatureIds: ids } : {}),
          attrs: [
            { name: 'Count', value: String(b.count) },
            { name: 'Time', value: formatEstCycleTime(b.timeSec) },
          ],
        });
      });
    }
    // Nothing real to show: say so, rather than a stand-in step name.
    if (featureNodes.length === 0 && showsStepTextRows(family)) {
      featureNodes.push({
        id: `nodata_${opIdx}`,
        kind: 'feature',
        label: 'No feature data',
        factory, machine,
        attrs: [{
          name: 'Reason',
          value: matchedCostLine
            ? 'The cost engine reports no per-feature breakdown for this step.'
            : 'No live cost line for this step yet - nothing to break down.',
        }],
      });
    }

    // A step that machines individual instances shows how many: "3 Axis Mill [5]".
    const instanceCount = breakdown.filter((b) => (b.occurrenceRefs ?? []).length > 0).length;
    const label = instanceCount > 0 ? `${rec.process} [${instanceCount}]` : rec.process;
    return { id: `op_${opIdx}`, kind: 'operation', label, factory, machine, children: featureNodes };
  });
  // The process group of each step: its cost line's own processGroup (the
  // machining after a casting is "Machining"), else the part's group.
  const opGroups = recs.map((rec) => lineForRec(rec)?.processGroup ?? groupLabel);

  // Inject Threaded Features from drawing intelligence for CNC families.
  //
  // FIXED: this used to always create a brand-new top-level "Threaded
  // Features" operation node with a hardcoded `machine: 'Tapping Machine'` —
  // a fabricated label, never the real resolved machine every other node in
  // this tree uses (realMachineName, off cost.processLines). Whenever a real
  // "Tapping" operation already exists (the normal case — Tapping is
  // costed/applied like any other step), that operation's own row already
  // shows the correct real machine (e.g. "Haas DS-30 with BAR3010SS
  // Feeder"); injecting a sibling with a different, fake machine name for
  // the same physical operation broke the Process → Machine → Operation
  // hierarchy the rest of the tree follows. Thread Features now nests
  // UNDER the real Tapping operation and inherits its real machine.
  const diThreadSpecs = isMachiningFamily
    ? ((item.drawingIntelligence as any)?.threads as { size: string; pitch: number; count: number }[] | undefined)
    : undefined;
  if (diThreadSpecs && diThreadSpecs.length > 0) {
    const tappingOp = operations.find((op) => op.label === 'Tapping');
    // '—' matches this tree's own convention elsewhere for "no machine
    // resolved yet" (see `machine` above) — never a fabricated name.
    const tappingMachine: string = tappingOp?.machine ?? '—';
    const threadChildren: ProcessTreeNode[] = diThreadSpecs.map((t, i) => ({
      id: `thread_di_${i}`,
      kind: 'feature' as const,
      label: `${t.size} ×${t.count}`,
      factory,
      machine: tappingMachine,
      source: 'drawing_intelligence',
      attrs: [
        { name: 'Specification', value: `${t.size} × ${t.pitch}` },
        { name: 'Count',         value: String(t.count) },
      ],
    }));
    const threadSubOp: ProcessTreeNode = {
      id: 'thread_features',
      kind: 'feature',
      label: 'Drawing thread callouts',
      children: threadChildren,
    };
    if (tappingOp) {
      tappingOp.children = [...(tappingOp.children ?? []), threadSubOp];
    } else {
      // No real Tapping process step exists on this part yet (e.g. not
      // costed/applied) — keep the finding visible as its own disclosed
      // top-level node rather than silently dropping it, but with an
      // honest '—' machine instead of a fabricated one.
      const deburrIdx = operations.findIndex((op) => op.label === 'Deburring');
      operations.splice(deburrIdx >= 0 ? deburrIdx : operations.length, 0, {
        id: 'op_threads',
        kind: 'operation',
        label: 'Threaded Features',
        factory,
        machine: '—',
        children: [threadSubOp],
      });
    }
  }

  // Processes the live engine computed for THIS route but that could never be
  // applied/persisted — physicsGap set (findRouteDataGaps rejects the WHOLE
  // apply-route request whenever any line has one, see engine-kernel.ts).
  // `recs` above deliberately never includes these once real stored rows
  // exist (storedRecs wins, per the comment on that fallback chain above), so
  // without this the tree would say nothing happened here at all — the same
  // gap the Direct Process Costs list had before its own unresolved row was
  // added. Append-only: never reads or mutates `recs`, so none of the real
  // fixes already documented on this function are at risk.
  // The cost line behind each unresolved step, so it groups with its own process group.
  const gapLineByOpId = new Map<string, NonNullable<typeof cost>['processLines'][number]>();
  const gapProcessLines = (cost?.processLines ?? []).filter(
    (l) => l.physicsGap && !operations.some((op) => op.label === l.process),
  );
  for (const l of gapProcessLines) {
    const gap = l.physicsGap!;
    const reasonText = gap.gapType === 'missing_lookup' ? gap.requiredAction : gap.reason;
    gapLineByOpId.set(`op_gap_${l.process}`, l);
    operations.push({
      id: `op_gap_${l.process}`,
      kind: 'operation',
      label: `${l.process} — unresolved`,
      processName: l.process,
      factory,
      machine: 'Not applied',
      attrs: [{ name: 'Reason', value: reasonText }],
    });
  }

  // 2-Model Machining: the catalog's "Source Component: As Supplied" step, first, with each occurrence the source already made (costing
  // nothing; its cost is the source component's, the part's material).
  if (cost?.sourceComponent && asSupplied.length > 0) {
    const source = cost.sourceComponent;
    operations.unshift({
      id: 'op_as_supplied',
      kind: 'operation',
      label: AS_SUPPLIED_STEP,
      processName: AS_SUPPLIED_STEP,
      factory,
      machine: source.name,
      attrs: [{ name: 'Source component', value: source.name }, { name: 'Occurrences', value: String(asSupplied.length) }],
      children: asSupplied.map((o) => ({
        id: `as_supplied_${o.featureId}_${o.occurrenceIndex}`,
        kind: 'feature' as const,
        label: `${o.featureType} ${o.occurrenceIndex + 1}`,
        factory,
        machine: source.name,
        v2Occurrences: [{ featureId: o.featureId, occurrenceIndex: o.occurrenceIndex }],
        attrs: [{ name: 'Feature', value: o.featureType }, { name: 'Faces', value: String(o.faceIds.length) }, { name: 'Machined', value: 'No: as supplied' }],
      })),
    });
  }

  // One group per process group, in route order; steps appended after the
  // route (threads, unresolved lines) stay in the part's group.
  const groups: ProcessTreeNode[] = [];
  operations.forEach((op) => {
    const idx = recs.findIndex((_, i) => op.id === `op_${i}`);
    const line = idx >= 0 ? lineForRec(recs[idx]!) : gapLineByOpId.get(op.id);
    const name = idx >= 0 ? opGroups[idx]! : line?.processGroup ?? groupLabel;
    let g = groups.find((x) => x.label === name);
    if (!g) {
      g = { id: `grp_${groups.length}`, kind: 'group', label: name, factory, children: [] };
      groups.push(g);
    }
    // A step in a process group other than the part's own (the machining after
    // a casting) sits under its machine class: Machining > 3 Axis Mill > Drilling.
    const route = line?.processRoute;
    if (route && route !== line?.process && name !== groupLabel) {
      let parent = g.children!.find((c) => c.kind === 'operation' && c.label === route && c.id.startsWith('route_'));
      if (!parent) {
        parent = { id: `route_${g.id}_${route}`, kind: 'operation', label: route, factory, machine: op.machine ?? '—', children: [] };
        g.children!.push(parent);
      }
      parent.children!.push(op);
      return;
    }
    g.children!.push(op);
  });
  return { id: 'root', kind: 'part', label: item.name, factory, children: groups };
}
