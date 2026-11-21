// What each hydroforming step does to which CAD feature, as memory's catalog states it (process_taxonomy_operations, staged from
// memory/Sheetmetal Hydroforming/operations): "Offline Blank:Blanking//Blank", "Offline Blank:Piercing//SimpleHole", "Hydroform:Hydroform
// Deep Draw:Deep Draw Forming//StraightBend", ... Each step's row names the part's own features (the feature graph's Blank, bends and drawn
// form; the hydroform measurement's holes, which include those through a formed wall) so the process tree lists them and highlights their
// faces. Display and trace only: no cost changes here. Pure.
import { catalogPairs, type CatalogOperation } from '../sheet-metal/operation/catalog-operation-resolver';

import type { HydroformPart } from './hydroforming-part';

/** A feature of the part's feature graph (feature_graph_v2.features), as much of it as the rows need. */
export interface HydroformGraphFeature { id: string; feature_type?: string | null; variant?: string | null }

/** The part's features, by what memory's catalog names them. */
export interface HydroformFeatures {
  blank: string[];
  bends: string[];
  forms: string[];
  /** The feature graph's holes (the Cost tab's rows highlight by these ids). */
  graphHoles: string[];
  /** The hydroform measurement's holes by type and diameter, each with its faces. */
  holes: { featureType: string; diameterMm: number | null; faceIds: number[][] }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function hydroformFeatures(graph: readonly HydroformGraphFeature[], part: HydroformPart): HydroformFeatures {
  const ids = (type: string, variant?: string) =>
    graph.filter((f) => f.feature_type === type && (variant == null || f.variant === variant)).map((f) => f.id);
  const groups = new Map<string, { featureType: string; diameterMm: number | null; faceIds: number[][] }>();
  for (const h of part.holes) {
    const dia = h.diameterMm != null ? r1(h.diameterMm) : null;
    const key = `${h.featureType}|${dia ?? '-'}`;
    const g = groups.get(key) ?? { featureType: h.featureType, diameterMm: dia, faceIds: [] };
    g.faceIds.push(h.faceIds);
    groups.set(key, g);
  }
  return {
    blank: ids('Blank'),
    bends: ids('StraightBend'),
    forms: ids('Form', 'drawn'),
    graphHoles: graph.filter((f) => f.feature_type === 'SimpleHole' || f.feature_type === 'ComplexHole').map((f) => f.id),
    holes: [...groups.values()].sort((a, b) => a.featureType.localeCompare(b.featureType) || (a.diameterMm ?? 0) - (b.diameterMm ?? 0)),
  };
}

/** A hole type memory's catalog has no row for (a slot) is pierced as a ComplexHole, the catalog's other hole. */
const catalogHoleType = (type: string) => (type === 'SimpleHole' ? 'SimpleHole' : 'ComplexHole');

/** The order of a press cycle's operations, as the Hydroform calculator runs them. */
const PRESS_ORDER = ['Loading', 'Deep Draw Forming', 'Fluid Cell Forming', 'Hand Adjusting', 'Clean Tooling', 'Visual Inspection', 'Unloading'];

/**
 * The catalog rows of the Offline Blank and of the quoted route's press, each listing the part's features it makes. A feature type the
 * catalog has no operation for on that step is not listed; a catalog row for a feature the part does not have makes no row.
 */
export function hydroformingCatalogOperations(
  catalog: readonly string[], routeLabel: string, formingOp: string, features: HydroformFeatures, handAdjusting: boolean,
): { blank: CatalogOperation[]; press: CatalogOperation[] } {
  const rows = catalog.map((raw) => ({ raw, pairs: catalogPairs(raw) })).filter((r) => r.pairs.length > 0);
  const blankRows = rows.filter((r) => r.raw.startsWith('Offline Blank:'));
  const pressRows = rows.filter((r) => r.raw.startsWith(`Hydroform:${routeLabel}:`));
  const has = (list: typeof rows, operation: string, featureType: string) =>
    list.some((r) => r.pairs[0].operation === operation && r.pairs[0].featureType === featureType);
  // The steps listed under an operation of a feature (the first pair below it, catalog order, once each).
  const subSteps = (operation: string, featureType: string) => {
    const out: { operation: string; featureType: string }[] = [];
    for (const r of blankRows) {
      const top = r.pairs[0]!;
      const next = r.pairs.at(1);
      if (top.operation === operation && top.featureType === featureType && next && !out.some((c) => c.operation === next.operation && c.featureType === next.featureType)) out.push(next);
    }
    return out;
  };
  const byIds = (operation: string, featureType: string, featureIds: string[], children: CatalogOperation['children'] = []): CatalogOperation =>
    ({ operations: [operation], featureType, variant: 'default', diameterMm: null, count: Math.max(1, featureIds.length), featureIds, status: 'resolved', children });
  const holeRow = (operation: string, h: HydroformFeatures['holes'][number], children: { operation: string; featureType: string }[]): CatalogOperation => ({
    operations: [operation], featureType: h.featureType, variant: 'through', diameterMm: h.diameterMm, count: h.faceIds.length, featureIds: [],
    featureFaceIds: h.faceIds, status: 'resolved', children: children.map((c) => ({ ...c, featureFaceIds: h.faceIds })),
  });

  const blank: CatalogOperation[] = [];
  if (has(blankRows, 'Blanking', 'Blank')) blank.push(byIds('Blanking', 'Blank', features.blank));
  for (const h of features.holes) {
    const type = catalogHoleType(h.featureType);
    if (has(blankRows, 'Piercing', type)) blank.push(holeRow('Piercing', h, subSteps('Piercing', type)));
  }

  // The press: the forming operation makes each feature type; the cycle's other operations act on it too (memory lists each against every type).
  const ops = [...new Set(pressRows.map((r) => r.pairs[0].operation))]
    .filter((o) => o !== formingOp && (o !== 'Hand Adjusting' || handAdjusting))
    .sort((a, b) => PRESS_ORDER.indexOf(a) - PRESS_ORDER.indexOf(b));
  const others = (featureType: string) => ops.filter((o) => has(pressRows, o, featureType)).map((operation) => ({ operation, featureType }));
  const press: CatalogOperation[] = [];
  if (features.forms.length && has(pressRows, formingOp, 'Form')) press.push(byIds(formingOp, 'Form', features.forms, others('Form')));
  if (features.bends.length && has(pressRows, formingOp, 'StraightBend')) press.push(byIds(formingOp, 'StraightBend', features.bends, others('StraightBend')));
  for (const h of features.holes) {
    const type = catalogHoleType(h.featureType);
    if (has(pressRows, formingOp, type)) press.push(holeRow(formingOp, h, others(type)));
  }
  return { blank, press };
}
