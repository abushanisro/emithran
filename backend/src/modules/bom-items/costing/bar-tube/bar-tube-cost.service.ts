import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../common/database/database.service';
import type { DbClient } from '../../../../common/db/postgrest-client';
import { escapeLikePattern, quoteFilterValue } from '../../../../common/db/postgrest-filter';
import { CalculatorCatalogService } from '../../services/calculator-catalog.service';
import type { CostContext } from '../casting/casting-finishing';
import { lineToLocal } from '../casting/sand/sand-cost';
import { SandMachineService } from '../casting/sand/sand-machine.service';
import type { SandReference } from '../casting/sand/sand-reference';
import { readStagedReference } from '../casting/sand/sand-reference.service';
import { loadBarTubeCalculatorSpec } from './calculators/bar-tube-calculator-spec';
import {
  BAR_TUBE_PROCESS_GROUP, BAR_TUBE_ROUTE_CLASSES, BAR_TUBE_ROUTES, STOCK_PRICE_FORM, buildBarTubeRoutes, chooseBarTubeRoute, type BarTubeMaterial, type BarTubePart, type BarTubeRoute, type BarTubeRouteGap, type BarTubeRouteKey,
} from './bar-tube-route';
import { cutCodeFamilyOf } from '../shared/core/cut-code';

const SOURCE_VERSION = '2026-BarTube';

/** The Cost Guide key of a bar and tube part: the route set by hand (saw, laser). */
export const BAR_TUBE_ROUTE_KEY = 'barTubeRoute';

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

/** The geometry as auto-fill promotes it (barTubeGeometry, from cad-engine bar_tube/feature_extractor.py). */
export interface BarTubeGeometrySummary {
  extractionVersion?: string | null;
  stockForm?: string | null;
  reason?: string | null;
  section?: Record<string, unknown> | null;
  developedLengthMm?: number | null;
  bends?: Array<Record<string, unknown>> | null;
  holes?: Array<Record<string, unknown>> | null;
  complexHoles?: Array<Record<string, unknown>> | null;
  cutouts?: Array<Record<string, unknown>> | null;
  ends?: Array<Record<string, unknown>> | null;
  forms?: Array<Record<string, unknown>> | null;
  /** A flat part cut from plate (cad-engine plate_measurements). */
  plate?: Record<string, unknown> | null;
}

/** The part's bounding box sides (mm, any order) and its volume (mm3): what a part that is not a length of stock is priced from. */
export interface BarTubeEnvelope {
  sidesMm: readonly number[];
  volumeMm3: number | null;
}

/** Sides this close (mm) make a square bar. */
const SQUARE_BAR_TOLERANCE_MM = 0.5;

/**
 * The bar that encloses a part that is not a length of stock: the box's two shorter sides as its section (a square bar when they are equal,
 * else a rectangular bar) and its longest as the length. Bar and Tube Fabrication saws it to length; the shape the part has within it is
 * not one of its operations, a No Cost Feature (bar-tube-route.ts). Never fails on a measured part (the user's decision 2026-11-20). Null
 * when the box is not measured.
 */
export function enclosingBar(envelope: BarTubeEnvelope, reason: string): BarTubePart | null {
  const [length = 0, width = 0, height = 0] = [...envelope.sidesMm].sort((a, b) => b - a);
  if (!(length > 0 && width > 0 && height > 0)) return null;
  return {
    stockForm: width - height <= SQUARE_BAR_TOLERANCE_MM ? 'SQUARE_BAR' : 'RECTANGULAR_BAR',
    section: { areaMm2: width * height, widthMm: width, heightMm: height, outerPerimeterMm: 2 * (width + height), odMm: null, wallMm: null, circumscribingDiameterMm: null, hollows: 0 },
    developedLengthMm: length, bends: [], holes: [], complexHoles: [], cutouts: [], ends: [], forms: [],
    enclosing: { reason, partVolumeMm3: envelope.volumeMm3 != null && envelope.volumeMm3 > 0 ? envelope.volumeMm3 : null },
  };
}

/**
 * The part as the routes take it, or what keeps it from being priced as a bar or tube (not measured, cut from plate without its
 * measurements). A measured part that is not a length of stock is priced as the bar that encloses it (enclosingBar).
 */
export function barTubePart(g: BarTubeGeometrySummary | null | undefined, envelope?: BarTubeEnvelope | null): { part: BarTubePart | null; missing: string[] } {
  if (!g?.extractionVersion) return { part: null, missing: ['the bar and tube measurements: press Refresh analysis so the part is measured as a bar or tube'] };
  if (!g.stockForm) {
    const reason = g.reason ?? 'no constant cross-section along a line';
    const part = envelope ? enclosingBar(envelope, reason) : null;
    return part ? { part, missing: [] } : { part: null, missing: [`the part is not a length of bar, tube or profile: ${reason}`] };
  }
  if (g.stockForm === 'PLATE') {
    const p = g.plate ?? {};
    const t = positive(p.thickness_mm);
    const cut = positive(p.cut_length_mm);
    const bl = positive(p.blank_length_mm);
    const bw = positive(p.blank_width_mm);
    const area = positive(p.face_area_mm2);
    if (t == null || cut == null || bl == null || bw == null || area == null) return { part: null, missing: ['the plate measurements: press Refresh analysis'] };
    return {
      part: {
        stockForm: 'PLATE',
        section: { areaMm2: bw * t, widthMm: bw, heightMm: t, outerPerimeterMm: 2 * (bw + t), odMm: null, wallMm: t, circumscribingDiameterMm: null },
        developedLengthMm: bl, bends: [], holes: [], complexHoles: [], cutouts: [], ends: [], forms: [],
        plate: { thicknessMm: t, cutLengthMm: cut, pierces: Math.max(1, Number(p.pierce_count ?? 1)), blankLengthMm: bl, blankWidthMm: bw, faceAreaMm2: area },
      },
      missing: [],
    };
  }
  const s = g.section ?? {};
  const area = positive(s.area_mm2);
  const width = positive(s.width_mm);
  const height = positive(s.height_mm);
  const length = positive(g.developedLengthMm);
  if (area == null || width == null || height == null || length == null) return { part: null, missing: ['the section or the developed length: press Refresh analysis'] };
  const end = (v: unknown): 'start' | 'end' => (v === 'end' ? 'end' : 'start');
  return {
    part: {
      stockForm: g.stockForm,
      section: {
        areaMm2: area, widthMm: width, heightMm: height, outerPerimeterMm: positive(s.outer_perimeter_mm) ?? 2 * (width + height),
        odMm: positive(s.od_mm), wallMm: positive(s.wall_mm) ?? positive(s.thickness_mm), circumscribingDiameterMm: positive(s.circumscribing_diameter_mm),
        hollows: num(s.hollows),
      },
      developedLengthMm: length,
      bends: (g.bends ?? []).map((b) => ({ clrMm: Number(b.clr_mm), angleDeg: Number(b.angle_deg), clockAngleDeg: num(b.clock_angle_deg), arcLengthMm: positive(b.arc_length_mm) }))
        .filter((b) => b.clrMm > 0 && b.angleDeg > 0),
      holes: (g.holes ?? []).map((h) => ({ featureType: String(h.feature_type ?? 'SimpleHole'), diameterMm: Number(h.diameter_mm), stationMm: num(h.station_mm) })).filter((h) => h.diameterMm > 0),
      complexHoles: (g.complexHoles ?? []).map((o) => ({ perimeterMm: Number(o.perimeter_mm), stationMm: num(o.station_mm) })).filter((o) => o.perimeterMm > 0),
      cutouts: (g.cutouts ?? []).map((o) => ({ perimeterMm: Number(o.perimeter_mm), stationMm: num(o.station_mm) })).filter((o) => o.perimeterMm > 0),
      ends: (g.ends ?? []).map((e) => ({ end: end(e.end), variant: String(e.variant ?? 'square'), cutAngleDeg: num(e.cut_angle_deg), cutPerimeterMm: positive(e.cut_perimeter_mm) })),
      forms: (g.forms ?? []).map((f) => ({ end: end(f.end), variant: String(f.variant ?? '') })),
    },
    missing: [],
  };
}

export interface BarTubeCostRequest {
  client: DbClient;
  accessToken: string;
  location: string;
  grade: string | null;
  geometry: BarTubeGeometrySummary | null | undefined;
  /** The part's bounding box and volume: a part that is not a length of stock is priced as the bar that encloses it. */
  envelope?: BarTubeEnvelope | null;
  /** A route to price instead of the chosen one (the route comparison prices each). */
  forceRoute?: string;
  overrides: Record<string, unknown> | null | undefined;
  batchSize: number;
  /** Parts the route's tooling is spread over (annual volume x production life); null when the scenario gives none. */
  amortizationParts?: number | null;
  /** USD -> the location's currency. */
  usdToLocal: number;
  costContext: CostContext;
}

export interface BarTubeCostResult {
  /** The quoted route in the location's currency; null when none can be built (see `missing`). */
  route: BarTubeRoute | null;
  routes: BarTubeRoute[];
  gaps: BarTubeRouteGap[];
  part: BarTubePart | null;
  note: string | null;
  missing: string[];
  warnings: string[];
}

function routeToLocal(route: BarTubeRoute, usdToLocal: number): BarTubeRoute {
  if (usdToLocal === 1) return route;
  return {
    ...route,
    lines: route.lines.map((l) => lineToLocal(l, usdToLocal)),
    material: { ...route.material, costUsd: route.material.costUsd != null ? route.material.costUsd * usdToLocal : null },
    totalUsd: route.totalUsd != null ? Math.round(route.totalUsd * usdToLocal * 100) / 100 : null,
  };
}

/**
 * Prices a bar, tube or profile part: loads the bar and tube reference data, the calculators (from the database), the machines of the location,
 * the material and the price of its stock form there, builds every route (bar-tube-route.ts) and returns them in the location's currency.
 */
@Injectable()
export class BarTubeCostService {
  constructor(
    private readonly database: DatabaseService,
    private readonly machines: SandMachineService,
    private readonly catalog: CalculatorCatalogService,
  ) {}

  private cached: SandReference | null = null;

  /** The staged memory/Bar and tube fab variables and lookup tables (read once; a read error is reported and not cached). */
  async reference(): Promise<{ reference: SandReference | null; missing: string[] }> {
    if (this.cached) return { reference: this.cached, missing: [] };
    const read = await readStagedReference(this.database, SOURCE_VERSION, BAR_TUBE_PROCESS_GROUP, 863);
    if (read.reference) this.cached = read.reference;
    return read;
  }

  /** The bar and tube material whose name or grade equals `name`, with the price of `stockForm` at `location`; null when it is not one. */
  async getMaterial(client: DbClient, ref: SandReference, name: string | null, stockForm: string, location: string): Promise<BarTubeMaterial | null> {
    const g = (name ?? '').trim();
    if (!g) return null;
    const { data, error } = await client.from('raw_materials')
      .select('id, name, grade, cut_code, material_type, density_kg_m3, uts_mpa, yield_strength_mpa, cost_usa, specific_heat_rt_j_kg_k, extrusion_exit_speed_max_mm_s')
      .eq('material_group', BAR_TUBE_PROCESS_GROUP)
      .or(`name.ilike.${quoteFilterValue(escapeLikePattern(g))},grade.ilike.${quoteFilterValue(escapeLikePattern(g))}`)
      .limit(2);
    if (error || !data || data.length !== 1) return null;
    const row = data[0] as Record<string, unknown>;
    const materialName = String(row.name ?? row.grade ?? g);
    const cutCode = num(row.cut_code);
    const families = new Set([...ref.table('saw_cut_rate'), ...ref.table('process_cut_rate')].map((r) => String(r['Material Cut Code Family'])));
    const form = STOCK_PRICE_FORM[stockForm];
    let price: number | null = null;
    let source: string | null = null;
    if (form) {
      const { data: prices } = await client.from('material_stock_prices')
        .select('price_per_kg, currency_code, source, reference_material, raw_material_name')
        .eq('stock_form', form).eq('location', location)
        .or(`reference_material.eq.${quoteFilterValue(materialName)},raw_material_name.eq.${quoteFilterValue(String(row.grade ?? materialName))}`)
        .limit(1);
      const p = (prices ?? [])[0] as Record<string, unknown> | undefined;
      if (p && String(p.currency_code) === 'USD' && positive(p.price_per_kg) != null) {
        price = positive(p.price_per_kg);
        source = `material_stock_prices ${form} ${location} (${String(p.source ?? '')})`;
      }
    }
    return {
      id: String(row.id), name: materialName, cutCode, cutCodeFamily: cutCodeFamilyOf(families, cutCode),
      materialType: row.material_type ? String(row.material_type) : null, densityKgM3: positive(row.density_kg_m3),
      utsMpa: positive(row.uts_mpa), yieldMpa: positive(row.yield_strength_mpa), costPerKgUsd: positive(row.cost_usa),
      specificHeatJKgK: positive(row.specific_heat_rt_j_kg_k), exitSpeedMaxMmS: positive(row.extrusion_exit_speed_max_mm_s),
      stockPricePerKgUsd: price, stockPriceSource: source,
    };
  }

  async price(req: BarTubeCostRequest): Promise<BarTubeCostResult> {
    const warnings: string[] = [];
    const none = (part: BarTubePart | null, ...missing: string[]): BarTubeCostResult => ({ route: null, routes: [], gaps: [], part, note: null, missing, warnings });
    const { part, missing: partMissing } = barTubePart(req.geometry, req.envelope);
    if (!part) return none(null, ...partMissing);
    if (part.enclosing) {
      warnings.push(`The part is not a length of bar, tube or profile (${part.enclosing.reason}): priced as the ${Math.round(part.section.widthMm * 10) / 10} x `
        + `${Math.round(part.section.heightMm * 10) / 10} mm ${part.stockForm.toLowerCase().replace(/_/g, ' ')} that encloses it, sawn to its ${Math.round(part.developedLengthMm * 10) / 10} mm `
        + `length. Its shape within the bar is a No Cost Feature: choose Machining to price it.`);
    }
    const o = req.overrides ?? {};
    const [{ reference, missing: refMissing }, calculators, machines] = await Promise.all([
      this.reference(),
      this.catalog.loadBarTubeCalculators(req.accessToken),
      this.machines.getMachinesByClass(req.client, BAR_TUBE_ROUTE_CLASSES, req.location),
    ]);
    if (!reference) return none(part, ...refMissing);
    const material = await this.getMaterial(req.client, reference, req.grade, part.stockForm, req.location);
    if (!material) return none(part, `"${req.grade ?? '(no material)'}" is not a bar and tube material in Raw Materials (material group ${BAR_TUBE_PROCESS_GROUP}): choose one in Material Grade`);
    const spec = loadBarTubeCalculatorSpec();
    const absent = spec.calculators.filter((c) => !calculators[c.name]).map((c) => c.name);
    if (absent.length) return none(part, `the bar and tube calculators are not in the database (run migration 1091): ${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', ...' : ''}`);
    if (!Object.values(machines).some((m) => m.length > 0)) return none(part, `HR Rates has no bar and tube machines for ${req.location}`);

    const keyOf = (v: unknown): BarTubeRouteKey | null => BAR_TUBE_ROUTES.find((r) => r.key === v)?.key ?? null;
    const chosen = keyOf(req.forceRoute) ?? keyOf(o[BAR_TUBE_ROUTE_KEY]);
    const { routes, gaps, missing } = buildBarTubeRoutes({
      ref: reference, spec, calculators, material, part, machinesByClass: machines, costContext: req.costContext,
      scenario: { batchSize: req.batchSize, route: chosen, amortizationParts: req.amortizationParts ?? null },
    });
    if (missing.length) return none(part, ...missing);
    const { route, note } = chooseBarTubeRoute(routes, gaps, chosen);
    if (!route) return { ...none(part, ...gaps.map((g) => `${g.label}: ${g.reason}`)), gaps };
    const local = routes.map((r) => routeToLocal(r, req.usdToLocal));
    return { route: local[routes.indexOf(route)]!, routes: local, gaps, part, note, missing: [], warnings: [...warnings, ...route.warnings] };
  }
}
