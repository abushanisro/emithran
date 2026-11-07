import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../../../common/db/postgrest-client';
import { escapeLikePattern, quoteFilterValue } from '../../../../../common/db/postgrest-filter';
import { PLASTIC_REFERENCE_SOURCE_VERSION } from '../plastic-reference';
import { evaluatePlasticDfm, holesOfPlasticGraph, type DraftFace, type MoldingProcessName, type PlasticDfmReference, type PlasticDfmResult } from './plastic-dfm';

export const MOLDING_PROCESS_NAMES: readonly MoldingProcessName[] = ['Injection Molding', 'Compression Molding', 'Reaction Injection Molding', 'Structural Foam Molding'];

export interface PlasticDfmView {
  status: 'ok' | 'no_analysis' | 'unavailable';
  result: PlasticDfmResult | null;
  /** Why there is no result, or what limits it (for example a material that is not in Raw Materials, whose material-specific rules then use the general rows). */
  reasons: string[];
}

/** The analysis of a plastic part as the DFM engine reads it (feature_graph.summary). */
interface PlasticSummary { plasticDraftFaces?: unknown; plasticFeatureGraph?: Parameters<typeof holesOfPlasticGraph>[0] }

/**
 * The design-for-molding checks of an item's analysis against the staged rule data (manufacturabilitySeverity, adviceRules, smallHoleDiamBorder), for the item's material
 * type. Evaluated when asked and not stored with the analysis: the material can change after the analysis, and the thresholds depend on it.
 */
@Injectable()
export class PlasticDfmService {
  private cached: { ref: PlasticDfmReference } | null = null;

  /** The rule data is public-read reference data: read with the caller's own client, so this service has no privileged access. */
  private async reference(db: DbClient): Promise<{ ref: PlasticDfmReference | null; missing: string[] }> {
    if (this.cached) return { ref: this.cached.ref, missing: [] };
    const [tables, vars] = await Promise.all([
      db.from('machining_reference_data').select('key, raw').eq('category', 'lookup_table').eq('source_version', PLASTIC_REFERENCE_SOURCE_VERSION).in('key', ['manufacturabilitySeverity', 'adviceRules']),
      db.from('machining_reference_data').select('key, value').eq('category', 'variable').eq('source_version', PLASTIC_REFERENCE_SOURCE_VERSION).eq('key', 'smallHoleDiamBorder'),
    ]);
    const error = tables.error ?? vars.error;
    if (error) return { ref: null, missing: [`DFM rule data (${error.message})`] };
    const rows = (key: string): Array<Record<string, unknown>> | null => {
      const r = (tables.data ?? []).find((t: { key: string }) => t.key === key) as { raw?: { rows?: unknown } } | undefined;
      return Array.isArray(r?.raw?.rows) ? (r!.raw!.rows as Array<Record<string, unknown>>) : null;
    };
    const severity = rows('manufacturabilitySeverity');
    const adviceRules = rows('adviceRules');
    if (!severity) return { ref: null, missing: ['the staged table manufacturabilitySeverity'] };
    const border = Number((vars.data ?? [])[0]?.value);
    const ref: PlasticDfmReference = { severity, adviceRules: adviceRules ?? [], smallHoleDiamBorderMm: Number.isFinite(border) ? border : null, version: PLASTIC_REFERENCE_SOURCE_VERSION };
    this.cached = { ref };
    return { ref, missing: [] };
  }

  /** The item's material type from Raw Materials (the "Material Type" the severity rows are keyed by), or null when the grade is not a staged material. */
  private async materialType(client: DbClient, grade: string | null): Promise<string | null> {
    const g = grade?.trim();
    if (!g) return null;
    const { data, error } = await client.from('raw_materials').select('material_type')
      .or(`name.ilike.${quoteFilterValue(escapeLikePattern(g))},grade.ilike.${quoteFilterValue(escapeLikePattern(g))}`).limit(2);
    if (error || !data || data.length === 0) return null;
    const types = [...new Set((data as Array<{ material_type: string | null }>).map((r) => r.material_type).filter((t): t is string => !!t))];
    return types.length === 1 ? types[0]! : null;
  }

  async evaluate(req: { featureGraph: unknown; grade: string | null; process: MoldingProcessName; client: DbClient }): Promise<PlasticDfmView> {
    const summary = ((req.featureGraph as { summary?: PlasticSummary } | null)?.summary ?? null) as PlasticSummary | null;
    if (!summary) return { status: 'no_analysis', result: null, reasons: ['The part has no CAD analysis: run it first.'] };
    const { ref, missing } = await this.reference(req.client);
    if (!ref) return { status: 'unavailable', result: null, reasons: missing };
    const materialType = await this.materialType(req.client, req.grade);
    const draftFaces = Array.isArray(summary.plasticDraftFaces) ? (summary.plasticDraftFaces as DraftFace[]) : null;
    const result = evaluatePlasticDfm({ draftFaces, holes: holesOfPlasticGraph(summary.plasticFeatureGraph) }, req.process, materialType, ref);
    const reasons = materialType ? [] : [`"${req.grade ?? '(no material)'}" has no single material type in Raw Materials: the rules that differ by material are judged by the general limits of ${req.process}`];
    return { status: 'ok', result, reasons };
  }
}
