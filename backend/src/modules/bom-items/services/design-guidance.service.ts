import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../../common/database/database.service';
import { escapeLikePattern, quoteFilterValue } from '../../../common/db/postgrest-filter';
import { isMachiningFamily } from '../../../domain/part-family';
import { castingSourcePath } from '../../sand-casting/casting-source';
import { castingProcessLabel, castingProcessOfFamily } from '../costing/casting/casting-cost-summary';
import { CastingReferenceService } from '../costing/casting/casting-reference.service';
import { SandCostService } from '../costing/casting/sand/sand-cost.service';
import { measuredWalls } from '../costing/machining/dfm/machining-dfm';
import { MachiningDfmService } from '../costing/machining/dfm/machining-dfm.service';
import { MachiningLookupService } from '../costing/machining/lookup/machining-lookup.service';
import { detectMaterialClass } from '../costing/machining/process/cost-machining-engine';
import { PlasticDfmService } from '../costing/plastic-molding/dfm/plastic-dfm.service';
import { sideActionSignals } from '../costing/plastic-molding/side-action-signals';
import { DEFAULT_COSTING_LOCATION, LOCATION_INFO } from '../costing/shared/core/default-rates.constants';
import { CAD_FAMILY_TO_PROCESS_GROUP } from '../costing/shared/core/part-family-process-group';
import type { CostTable } from '../costing/shared/cost-table';
import { buildDesignGuidance, type DesignGuidance, type DesignGuidanceInput, type GuidanceFeature, type GuidanceSeverity, type ReviewItem } from '../costing/shared/design-guidance';
import { resolveCostingInputs } from '../costing/shared/physics/costing-inputs';
import type { BOMItemResponseDto } from '../dto/bom-item-response.dto';
import { CostTableService } from './cost-table.service';
import { FeatureToleranceService } from './feature-tolerance.service';
import { MaterialResolutionService } from './material-resolution.service';

type Summary = Record<string, unknown>;
type MaterialRow = { name: string; material_type: string | null; density_kg_m3: number | string | null; density: number | string | null } & Record<string, unknown>;

/** Finishing processes that are not a cutting tool on a machining centre: a tolerance only these hold needs a specialised operation. */
const SPECIALISED_FINISHING = /grind|hon(e|ing)|lap|superfinish|polish|burnish/i;

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
};
const severityOf = (s: string): GuidanceSeverity => (s.toLowerCase() as GuidanceSeverity);

/** The library keeps density in kg/m3 (density_kg_m3) or, on older rows, g/cm3 (density). */
const densityOf = (r: { density_kg_m3?: unknown; density?: unknown }): number | null => num(r.density_kg_m3) ?? (num(r.density) != null ? num(r.density)! * 1000 : null);

/**
 * The Design Guidance of an item (costing/shared/design-guidance.ts). It gathers what the engines and the reference data already hold for the part's process
 * (its DFM findings, the walls and their limits, the mold tooling, the tolerances, the applied routing) and the material library rows the process draws from.
 * It prices nothing and decides no limit.
 */
@Injectable()
export class DesignGuidanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly costTables: CostTableService,
    private readonly materials: MaterialResolutionService,
    private readonly machiningDfm: MachiningDfmService,
    private readonly machiningLookup: MachiningLookupService,
    private readonly plasticDfm: PlasticDfmService,
    private readonly sandCost: SandCostService,
    private readonly castingReference: CastingReferenceService,
    private readonly tolerances: FeatureToleranceService,
  ) {}

  async forItem(item: BOMItemResponseDto, token: string): Promise<DesignGuidance> {
    const fg = (item.featureGraph ?? null) as { summary?: Summary; feature_graph_v2?: { features?: unknown } } | null;
    const summary: Summary = fg?.summary ?? {};
    const grade = item.materialGrade?.trim() || null;
    const { family } = this.materials.resolveEffectiveFamily({ item, fg, grade, sheetThicknessMm: Number(item.sheetThicknessMm) || 0 });
    const chosenGroup = typeof item.scenarioOverrides?.processGroup === 'string' ? item.scenarioOverrides.processGroup : null;
    const processGroup = chosenGroup || CAD_FAMILY_TO_PROCESS_GROUP[family] || null;
    const machined = isMachiningFamily(family);
    const casting = castingProcessOfFamily(family);
    const molded = family === 'plastic_molded';
    const features = (Array.isArray(fg?.feature_graph_v2?.features) ? fg!.feature_graph_v2!.features : []) as GuidanceFeature[];
    const client = this.database.getUserClient(token);

    const inputs = resolveCostingInputs({ scenarioOverrides: item.scenarioOverrides ?? null, item: { annualVolume: item.annualVolume ?? null } });
    const location = inputs.location ?? DEFAULT_COSTING_LOCATION;
    const info = LOCATION_INFO[location] ?? LOCATION_INFO[DEFAULT_COSTING_LOCATION]!;

    const [table, library, dfm, toleranced, secondary, setup] = await Promise.all([
      this.costTables.forItem(item.id, token),
      this.library(client, processGroup, info.materialCol, grade),
      this.findings({ item, fg, grade, token, machined, molded, sand: casting === 'sand_casting' }),
      this.toleranced(item.id, token),
      machined ? Promise.resolve({ value: null, reason: null }) : this.secondaryMachining(item.id, token),
      features.length > 0 ? this.machiningLookup.getSetupAxisRule() : Promise.resolve({ rule: null, missing: [] }),
    ]);

    const applied = table.rows.some((r) => r.kind !== 'part');
    const part = table.rows.find((r) => r.kind === 'part');
    const utilization = part?.values.utilizationPct;
    const routing = applied ? this.machiningRouting(table, machined) : null;
    const thickness = await this.thickness({ summary, features, grade, machined, molded, casting, family, sheetThicknessMm: num(item.sheetThicknessMm), materialType: library.row?.material_type ?? null, plasticLimits: dfm.plasticLimits, appliedProcesses: table.rows.filter((r) => r.kind === 'process').map((r) => r.name) });

    const input: DesignGuidanceInput = {
      family, processGroup, features, machined,
      findings: dfm.findings, findingsReason: dfm.reason,
      material: {
        name: library.row?.name ?? grade,
        currency: info.code,
        row: library.row ? { pricePerKg: num(library.row[info.materialCol]), densityKgM3: densityOf(library.row) } : null,
        volumeMm3: num(item.volume),
        comparables: library.comparables.map((r) => ({ pricePerKg: num(r[info.materialCol]), densityKgM3: densityOf(r) })),
        comparedGroups: library.groups,
      },
      thickness,
      moldTooling: this.moldTooling(summary, molded, casting),
      routing,
      utilizationPct: typeof utilization === 'number' && utilization > 0 ? utilization : null,
      secondaryMachining: secondary.value, secondaryMachiningReason: secondary.reason,
      toleranced,
      setupRule: setup.rule,
      nonStandardHoles: dfm.nonStandardHoles,
    };
    return buildDesignGuidance(input);
  }

  /** The applied operations that are machining: every operation of a machined part, the operations of a machining group otherwise. */
  private machiningRouting(table: CostTable, machined: boolean): string[] {
    const groups = new Set(table.rows.filter((r) => r.kind === 'group' && /machin/i.test(r.name)).map((r) => r.id));
    return table.rows.filter((r) => r.kind === 'process' && (machined || (r.parentId != null && groups.has(r.parentId)))).map((r) => r.name);
  }

  /** The part's material row, and the rows of the material groups its process draws from (process_material_groups), priced in the location's column. */
  private async library(client: ReturnType<DatabaseService['getUserClient']>, processGroup: string | null, priceColumn: string, grade: string | null): Promise<{ row: MaterialRow | null; comparables: MaterialRow[]; groups: string[] }> {
    const columns = `name, material_type, density_kg_m3, density, ${priceColumn}`;
    let row: MaterialRow | null = null;
    if (grade) {
      const { data } = await client.from('raw_materials').select(columns)
        .or(`name.ilike.${quoteFilterValue(escapeLikePattern(grade))},grade.ilike.${quoteFilterValue(escapeLikePattern(grade))}`).limit(5);
      const rows = (data ?? []) as unknown as MaterialRow[];
      const exact = rows.filter((r) => r.name === grade);
      row = exact.length === 1 ? exact[0]! : rows.length === 1 ? rows[0]! : null;
    }
    if (!processGroup) return { row, comparables: [], groups: [] };
    const { data: links } = await client.from('process_material_groups').select('material_group').eq('process_group', processGroup);
    const groups = [...new Set(((links ?? []) as Array<{ material_group: string }>).map((l) => l.material_group))].sort();
    if (groups.length === 0) return { row, comparables: [], groups };
    // The API returns a page at a time: read every page, so the range is of the whole library and not of its first rows.
    const comparables: MaterialRow[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client.from('raw_materials').select(columns).in('material_group', groups).order('id').range(from, from + PAGE - 1);
      if (error || !data) break;
      comparables.push(...(data as unknown as MaterialRow[]));
      if (data.length < PAGE) break;
    }
    // A material is listed once in each group that uses it, at that group's price: the part's row is the one of its own process.
    const own = grade ? comparables.filter((r) => r.name === grade) : [];
    return { row: own[0] ?? row, comparables, groups };
  }

  /** The findings of the DFM engine of the part's process. A process with no DFM engine has none, and says so. */
  private async findings(req: { item: BOMItemResponseDto; fg: unknown; grade: string | null; token: string; machined: boolean; molded: boolean; sand: boolean }): Promise<{
    findings: ReviewItem[] | null; reason: string | null; nonStandardHoles: DesignGuidanceInput['nonStandardHoles']; plasticLimits: { minMm: number | null; maxMm: number | null } | null;
  }> {
    const { item } = req;
    const none = { nonStandardHoles: null, plasticLimits: null };
    if (req.molded) {
      const view = await this.plasticDfm.evaluate({ featureGraph: req.fg, grade: req.grade, process: 'Injection Molding', client: this.database.getClient(req.token) });
      if (!view.result) return { findings: null, reason: view.reasons.join(' '), ...none };
      return {
        findings: view.result.findings.map((f) => ({ label: f.label, detail: f.note, severity: severityOf(f.severity), occurrences: [], faces: f.faces })),
        reason: null, nonStandardHoles: null, plasticLimits: view.result.sectionLimits,
      };
    }
    if (req.sand) {
      const view = await this.sandCost.dfm({
        bomItemId: item.id, sourcePath: castingSourcePath({ file_3d_path: item.file3dPath, file_step_path: item.fileStepPath }), grade: req.grade,
        client: this.database.getUserClient(req.token), accessToken: req.token,
      });
      if (!view.result) return { findings: null, reason: view.reasons.join(' '), ...none };
      return {
        findings: view.result.findings.map((f) => ({
          label: `${f.title}: ${Number(f.measured.toFixed(3))}${f.unit ? ` ${f.unit}` : ''} (${f.comparison === '<' ? 'below' : 'above'} ${f.severity.toLowerCase()} limit ${f.threshold})`,
          detail: f.note, severity: severityOf(f.severity), occurrences: [], faces: f.faces,
        })),
        reason: null, ...none,
      };
    }
    // The machining checks run on any part that carries machined features: a machined part, and the machined features of a cast one.
    const view = await this.machiningDfm.evaluate({ featureGraph: req.fg, grade: req.grade, part: { dimensionsMm: [item.maxLength, item.maxWidth, item.maxHeight], weightKg: item.weight } });
    if (!view.result) {
      return { findings: null, reason: req.machined ? view.reasons.join(' ') : 'The design checks of this process are not modelled yet: only machining, plastic molding and sand casting have them.', ...none };
    }
    const toItem = (f: (typeof view.result.findings)[number]): ReviewItem => ({ label: f.label, detail: f.recommendation, severity: f.severity, occurrences: f.occurrences, faces: f.faces });
    const drill = view.result.checks.find((c) => c.rule === 'NonStandardHoleDiameter');
    const drillFinding = view.result.findings.find((f) => f.rule === 'NonStandardHoleDiameter');
    return {
      findings: view.result.findings.map(toItem), reason: null, plasticLimits: null,
      nonStandardHoles: drillFinding ? toItem(drillFinding) : drill && drill.status === 'passed' ? 'none' : null,
    };
  }

  /** The features carrying a tolerance requirement (a drawing or model callout, a manual value, or the item's uniform policy). */
  private async toleranced(id: string, token: string): Promise<ReviewItem[] | null> {
    try {
      const view = await this.tolerances.get(id, token);
      return view.instances.filter((i) => i.requirements.length > 0).map(({ instance, requirements }) => ({
        label: instance.label,
        detail: requirements.map((r) => `${r.category} ${r.value}`).join(', '),
        severity: null,
        occurrences: instance.featureId ? [{ featureId: instance.featureId, occurrenceIndex: instance.occurrenceIndex }] : [],
        faces: instance.faceIds,
      }));
    } catch {
      return null;
    }
  }

  /** On a part whose primary process is not machining: the features that process leaves short of their tolerances (or cannot form). */
  private async secondaryMachining(id: string, token: string): Promise<{ value: DesignGuidanceInput['secondaryMachining']; reason: string | null }> {
    try {
      const need = await this.tolerances.getMachiningNeed(id, token);
      if (!need.assessed || !need.result) return { value: null, reason: need.reason ?? 'Which features need machining after the primary process was not assessed.' };
      const needing = need.result.features.filter((f) => f.verdict === 'needs_machining');
      const toItem = (f: (typeof needing)[number]): ReviewItem => ({
        label: f.label, detail: f.reasons.join(' ') || null, severity: null,
        occurrences: f.featureId ? [{ featureId: f.featureId, occurrenceIndex: f.occurrenceIndex }] : [], faces: f.faceIds,
      });
      // Specialised finishing: every operation able to hold the feature's tolerances is an abrasive one.
      const finishing = needing.filter((f) => f.candidates.length > 0 && f.candidates.every((c) => SPECIALISED_FINISHING.test(c.capabilityProcess) || SPECIALISED_FINISHING.test(c.operation)));
      return { value: { items: needing.map(toItem), finishingItems: finishing.map(toItem) }, reason: null };
    } catch (error) {
      return { value: null, reason: error instanceof Error ? error.message : 'Which features need machining after the primary process could not be assessed.' };
    }
  }

  /** The slides, lifters and cores the analysis found. Null on a process with no mold or die. */
  private moldTooling(summary: Summary, molded: boolean, casting: ReturnType<typeof castingProcessOfFamily>): DesignGuidanceInput['moldTooling'] {
    if (molded) {
      const signals = sideActionSignals(summary.plasticFeatureGraph as Parameters<typeof sideActionSignals>[0]);
      if (!signals) return { slides: null, lifters: null, cores: null, liftersReason: 'The analysis has no plastic feature graph: run the CAD analysis.', coresReason: 'The analysis has no plastic feature graph: run the CAD analysis.', items: [] };
      return {
        slides: signals.slideBundles, lifters: signals.slideOrLifterBundles, cores: null,
        coresReason: 'The molded core is one side of the tool and is not counted as a separate item.',
        items: [],
      };
    }
    if (casting === 'die_casting') {
      const cores = Array.isArray(summary.castingCores) ? summary.castingCores.length : null;
      return {
        slides: typeof summary.castingSlideBundleCount === 'number' ? summary.castingSlideBundleCount : null,
        lifters: null, cores,
        liftersReason: 'A die casting die has slides, not lifters.',
        coresReason: 'The analysis did not report the cores (an analysis older than the core recognition).',
        items: [],
      };
    }
    if (casting === 'sand_casting') {
      const cores = Array.isArray(summary.castingCores) ? summary.castingCores.length : null;
      return {
        slides: null, lifters: null, cores,
        liftersReason: 'A sand mold has no slides or lifters: an undercut is made with a core.',
        coresReason: 'The analysis did not report the cores (an analysis older than the core recognition).',
        items: [],
      };
    }
    return null;
  }

  /** The part's thinnest and thickest wall, and the wall the process and material are advised to stay within, each from the process's own table. */
  private async thickness(req: {
    summary: Summary; features: readonly GuidanceFeature[]; grade: string | null; machined: boolean; molded: boolean; casting: ReturnType<typeof castingProcessOfFamily>;
    family: string; sheetThicknessMm: number | null; materialType: string | null; plasticLimits: { minMm: number | null; maxMm: number | null } | null; appliedProcesses: string[];
  }): Promise<DesignGuidanceInput['thickness']> {
    const { summary } = req;
    const base = { recommendedMinMm: null, recommendedMaxMm: null, source: null, reasons: {}, items: [] } as Omit<DesignGuidanceInput['thickness'], 'partMinMm' | 'partMaxMm'>;
    if (req.molded) {
      return {
        ...base, partMinMm: num(summary.wallThicknessMinMm), partMaxMm: num(summary.wallThicknessMaxMm),
        recommendedMinMm: req.plasticLimits?.minMm ?? null, recommendedMaxMm: req.plasticLimits?.maxMm ?? null,
        source: req.plasticLimits ? 'manufacturabilitySeverity (ThinSection, ThickSection)' : null,
      };
    }
    if (req.casting) {
      const measured = { partMinMm: num(summary.castingWallMinMm), partMaxMm: num(summary.castingWallMaxMm) };
      if (req.casting === 'investment_casting') {
        const why = 'The investment casting wall limits are not staged yet.';
        return { ...base, ...measured, reasons: { min: why, max: why } };
      }
      const { reference } = await this.castingReference.getCastabilityReference(req.casting);
      const names = [...req.appliedProcesses, castingProcessLabel(req.casting)];
      const row = reference?.wallLimits.find((w) => w.materialType === req.materialType && names.includes(w.process));
      const why = !reference ? 'The casting wall table (tblWallThickness) is not staged.'
        : !req.materialType ? 'The material has no Material Type in the library, which the wall table is keyed by.'
        : `tblWallThickness has no row for ${req.materialType} and ${castingProcessLabel(req.casting)}.`;
      return row
        ? { ...base, ...measured, recommendedMinMm: row.minMm, recommendedMaxMm: row.maxMm, source: `tblWallThickness (${row.process}, ${row.materialType})` }
        : { ...base, ...measured, reasons: { min: why, max: why } };
    }
    if (req.family === 'sheet_metal') {
      const why = 'A sheet metal part has one gauge: the limits on it are the machines\' (the route comparison), not a recommended wall.';
      return { ...base, partMinMm: req.sheetThicknessMm, partMaxMm: req.sheetThicknessMm, reasons: { min: why, max: why, measured: 'The sheet thickness is not on file.' } };
    }
    // Machined: the wall beside each feature. The thickest section of a machined part is its stock, which has no recommended maximum.
    const walls = measuredWalls(req.features);
    const minWall = req.features.length > 0 ? await this.machiningLookup.getMachiningMinWall(detectMaterialClass(req.grade)) : null;
    const thin = minWall ? walls.filter((w) => w.value < minWall.recommendedMm) : [];
    return {
      ...base,
      partMinMm: walls.length ? Math.min(...walls.map((w) => w.value)) : null,
      partMaxMm: walls.length ? Math.max(...walls.map((w) => w.value)) : null,
      recommendedMinMm: minWall?.recommendedMm ?? null,
      source: minWall ? `tblMachiningMinWall (${detectMaterialClass(req.grade)})` : null,
      reasons: {
        measured: 'The analysis did not measure the wall beside the features (run Refresh analysis).',
        min: 'The machining minimum wall table (tblMachiningMinWall) is not staged.',
        max: 'A machined part is cut from solid stock: there is no recommended maximum wall.',
      },
      items: thin.length
        ? [{ label: `${thin.length} wall${thin.length === 1 ? '' : 's'} thinner than ${minWall!.recommendedMm} mm, thinnest ${Math.min(...thin.map((w) => w.value))} mm`, detail: null, severity: 'minor', occurrences: thin.map((w) => ({ featureId: w.featureId, occurrenceIndex: w.occurrenceIndex })), faces: thin.flatMap((w) => w.faces) }]
        : [],
    };
  }
}
