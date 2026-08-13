import { Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CostAggregationService, BomItemCostDto, ProcessLine, MaterialLine } from './cost-aggregation.service';
import { BOMItemsService } from '../bom-items/bom-items.service';
import type { CostSummaryDto, CalculationTraceStep, FeatureOp } from '../bom-items/dto/cost-breakdown.dto';

interface BomItemHeaderFields {
  part_number: string | null;
  name: string | null;
  description: string | null;
  material: string | null;
  material_grade: string | null;
  quantity: number | null;
  annual_volume: number | null;
  weight: number | null;
  volume: number | null;
  surface_area: number | null;
  sheet_thickness_mm: number | null;
  cut_length_mm: number | null;
  bend_count: number | null;
  hole_count: number | null;
  pierce_count: number | null;
  flat_pattern_area_mm2: number | null;
  max_length: number | null;
  max_width: number | null;
  max_height: number | null;
  make_buy: string | null;
  family_classification: string | null;
  thumbnail_url: string | null;
}

// ── Style constants ─────────────────────────────────────────────────────────
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' } };
const SECTION_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
// Editable-input cells get a light-blue fill + blue font — the standard
// financial-modeling convention (blue = you can type here, black = formula).
// Every cell using this fill is a genuine input the formulas below read from;
// nothing is decorated as an input that isn't actually wired into a formula.
const INPUT_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
const INPUT_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FF1D4ED8' } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } };
const TITLE_FONT: Partial<ExcelJS.Font> = { bold: true, size: 16 };
const SECTION_FONT: Partial<ExcelJS.Font> = { bold: true, size: 10 };
const LABEL_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FF4B5563' } };
// All cost figures render at 2 decimal places — one consistent format everywhere.
const CURRENCY_FMT = '$#,##0.00';
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
  right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
};

@Injectable()
export class ExcelReportService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly costAggregation: CostAggregationService,
    private readonly bomItemsService: BOMItemsService,
  ) {}

  async generateBomItemReport(
    bomItemId: string,
    userId: string,
    accessToken: string,
    batchSizeParam?: number,
    locationParam?: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const [cost, item] = await Promise.all([
      this.costAggregation.computeBomItemCost(bomItemId, accessToken),
      this.fetchItemHeaderFields(bomItemId, accessToken),
    ]);

    // Live CAD-driven recompute — the SAME engine (computeCostSummary via
    // BOMItemsService.getCostSummary) that powers the on-screen Direct Process
    // Costs panel, including per-process feature breakdowns and calculation
    // traces. Sheet 1 above is built from the saved/applied route
    // (process_cost_records); this is a fresh live computation from CAD
    // geometry, so it can legitimately differ if the applied route was
    // manually edited/overridden after costing — the detail sheet says so
    // explicitly rather than presenting two silently-differing numbers as
    // if they were one.
    const batchSize = batchSizeParam ?? cost.processLines[0]?.batchSize ?? 1;
    const location = locationParam ?? cost.processLines.find((l) => l.location)?.location ?? '';
    let liveSummary: CostSummaryDto | null = null;
    let liveSummaryError: string | null = null;
    if (location) {
      try {
        liveSummary = await this.bomItemsService.getCostSummary(bomItemId, userId, accessToken, batchSize, location);
      } catch (err: any) {
        liveSummaryError = err?.message ?? 'Live recompute failed';
      }
    } else {
      liveSummaryError = 'No digital factory location on file for this route — live verification unavailable.';
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Mithran';
    wb.created = new Date();

    this.buildReportSheet(wb, item, cost);
    this.buildCalculationDetailSheet(wb, item, liveSummary, liveSummaryError);

    const arrayBuffer = await wb.xlsx.writeBuffer();
    const rawName = item.name ?? item.description ?? item.part_number ?? bomItemId;
    const safeName = rawName.replace(/[\\/:*?"<>|]/g, '-').trim();
    const filename = `${safeName}-Cost-Report.xlsx`;
    return { buffer: Buffer.from(arrayBuffer), filename };
  }

  private async fetchItemHeaderFields(bomItemId: string, accessToken?: string): Promise<BomItemHeaderFields> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('bom_items')
      .select(
        'part_number, name, description, material, material_grade, quantity, annual_volume, weight, ' +
        'volume, surface_area, sheet_thickness_mm, cut_length_mm, bend_count, hole_count, pierce_count, ' +
        'flat_pattern_area_mm2, max_length, max_width, max_height, make_buy, family_classification, thumbnail_url',
      )
      .eq('id', bomItemId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`BOM item ${bomItemId} not found or not accessible.`);
    }
    return data as unknown as BomItemHeaderFields;
  }

  // Parses a `data:image/jpeg;base64,...` thumbnail into the {base64, extension}
  // shape exceljs' workbook.addImage() needs. Returns null for anything else
  // (missing thumbnail, or a non-data-URI value) — the sheet lays out cleanly
  // without the image rather than guessing at a placeholder.
  private parseThumbnail(dataUri: string | null): { base64: string; extension: 'jpeg' | 'png' } | null {
    if (!dataUri) return null;
    const match = dataUri.match(/^data:image\/(jpeg|jpg|png);base64,(.+)$/);
    if (!match) return null;
    const extension = match[1] === 'png' ? 'png' : 'jpeg';
    return { base64: dataUri, extension };
  }

  // ── Sheet 1: Part Cost Report — fully formula-driven ─────────────────────────
  private buildReportSheet(wb: ExcelJS.Workbook, item: BomItemHeaderFields, cost: BomItemCostDto) {
    const ws = wb.addWorksheet('Part Cost Report');
    const lines = cost.processLines.slice().sort((a, b) => a.opNbr - b.opNbr);
    const colCount = 3 + lines.length; // Cost Element | Part Total | Material Stock | one per process
    ws.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, ...lines.map(() => ({ width: 20 }))];
    const colLetter = (n: number) => ws.getColumn(n).letter;

    // ── Letterhead: 3D thumbnail top-left, title + key identifiers beside it,
    // deliberate gap row before the report body ─────────────────────────────
    const IMAGE_ROWS = 8;
    for (let i = 1; i <= IMAGE_ROWS; i++) ws.getRow(i).height = 20;

    const thumb = this.parseThumbnail(item.thumbnail_url);
    if (thumb) {
      const imageId = wb.addImage({ base64: thumb.base64, extension: thumb.extension });
      ws.addImage(imageId, { tl: { col: 0, row: 0 }, ext: { width: 140, height: 140 }, editAs: 'oneCell' });
    } else {
      ws.mergeCells(1, 1, IMAGE_ROWS, 2);
      const cell = ws.getCell(1, 1);
      cell.value = 'No 3D preview\ncaptured for this part';
      cell.font = { italic: true, size: 8, color: { argb: 'FF9CA3AF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { top: { style: 'thin', color: { argb: 'FFE5E7EB' } }, bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } }, left: { style: 'thin', color: { argb: 'FFE5E7EB' } }, right: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
    }

    let r = 1;
    ws.mergeCells(r, 3, r, 4);
    ws.getCell(r, 3).value = 'Part Cost Report';
    ws.getCell(r, 3).font = TITLE_FONT;
    r++;
    ws.mergeCells(r, 3, r, 4);
    ws.getCell(r, 3).value = `Generated ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })}  ·  `
      + 'blue cells are inputs — edit them and the cost recalculates';
    ws.getCell(r, 3).font = { italic: true, size: 8, color: { argb: 'FF9CA3AF' } };
    r++;

    const labelValue = (row: number, col: number, label: string, value: ExcelJS.CellValue) => {
      ws.getCell(row, col).value = label;
      ws.getCell(row, col).font = LABEL_FONT;
      ws.getCell(row, col + 1).value = value;
    };

    const partName = item.name ?? item.description ?? null;
    const digitalFactory = lines.find((l) => l.location)?.location ?? null;
    const batchSizeHeader = lines[0]?.batchSize ?? null;
    const materialUnitCost = cost.materialLines[0]?.unitCost ?? null;
    const processGroups = [...new Set(lines.map((l) => l.processGroup).filter(Boolean))].join(', ') || null;

    r++;
    labelValue(r, 3, 'Part Number', item.part_number ?? '—');
    labelValue(r, 5, 'Digital Factory', digitalFactory ?? '—');
    r++;
    labelValue(r, 3, 'Part Name', partName ?? '—');
    labelValue(r, 5, 'Batch Size', batchSizeHeader ?? '—');
    r++;
    labelValue(r, 3, 'Material', [item.material, item.material_grade].filter(Boolean).join(' / ') || '—');
    labelValue(r, 5, 'Annual Volume', item.annual_volume ?? '—');
    r++;
    labelValue(r, 3, 'Process Group', processGroups ?? item.family_classification ?? '—');
    labelValue(r, 5, 'Quantity', item.quantity ?? '—');
    r++;
    labelValue(r, 3, 'Weight (kg)', item.weight ?? '—');
    labelValue(r, 5, 'Material Unit Cost ($/kg)', materialUnitCost != null ? materialUnitCost : '—');
    if (ws.getCell(r, 6).value != null) ws.getCell(r, 6).numFmt = CURRENCY_FMT;
    r++;
    labelValue(r, 3, 'Make / Buy', item.make_buy ?? '—');
    labelValue(r, 5, 'Currency', 'USD');
    r = Math.max(r + 1, IMAGE_ROWS + 2);

    ws.getRow(r).height = 8; // deliberate gap
    r += 2;

    // ── Part Geometry — the real physical drivers behind the cycle-time/cost
    // numbers below (why a laser-cut line costs what it does: cut length,
    // pierce count; why a bend line costs what it does: bend count, thickness).
    const hasGeometry = [item.sheet_thickness_mm, item.cut_length_mm, item.bend_count, item.hole_count,
      item.pierce_count, item.flat_pattern_area_mm2, item.volume, item.surface_area, item.max_length].some((v) => v != null);
    if (hasGeometry) {
      ws.mergeCells(r, 1, r, colCount);
      ws.getCell(r, 1).value = 'Part Geometry (cost drivers)';
      ws.getCell(r, 1).font = SECTION_FONT;
      ws.getCell(r, 1).fill = SECTION_FILL;
      for (let c = 2; c <= colCount; c++) ws.getCell(r, c).fill = SECTION_FILL;
      r++;
      const envelope = [item.max_length, item.max_width, item.max_height].every((v) => v != null)
        ? `${item.max_length} × ${item.max_width} × ${item.max_height}` : null;
      labelValue(r, 1, 'Sheet Thickness (mm)', item.sheet_thickness_mm ?? '—');
      labelValue(r, 3, 'Cut Length (mm)', item.cut_length_mm ?? '—');
      r++;
      labelValue(r, 1, 'Bend Count', item.bend_count ?? '—');
      labelValue(r, 3, 'Hole Count', item.hole_count ?? '—');
      r++;
      labelValue(r, 1, 'Pierce Count', item.pierce_count ?? '—');
      labelValue(r, 3, 'Flat Pattern Area (mm²)', item.flat_pattern_area_mm2 ?? '—');
      r++;
      labelValue(r, 1, 'Volume (mm³)', item.volume ?? '—');
      labelValue(r, 3, 'Surface Area (mm²)', item.surface_area ?? '—');
      r++;
      labelValue(r, 1, 'Envelope L × W × H (mm)', envelope ?? '—');
      r += 2;
    }

    // ── Machine route ─────────────────────────────────────────────────────────
    const route = lines.map((l) => l.machineName ?? l.operation ?? l.processGroup ?? '?').join('  >  ');
    ws.getCell(r, 1).value = 'Machine Route';
    ws.getCell(r, 1).font = LABEL_FONT;
    ws.mergeCells(r, 2, r, colCount);
    ws.getCell(r, 2).value = route || '—';
    ws.getCell(r, 2).alignment = { wrapText: true };
    r += 2;

    // ── Material Lines — formula-driven 8-step (real raw_material_cost_records
    // formula: gross → reclaim → net → scrap adj → overhead → total). Placed
    // before the process table so its Total Cost cells exist and can be
    // referenced by the Raw Material Cost row below. ────────────────────────
    let matTotalRange: string | null = null;
    if (cost.materialLines.length > 0) {
      ws.mergeCells(r, 1, r, colCount);
      ws.getCell(r, 1).value = 'Material Lines (editable — 8-step formula)';
      ws.getCell(r, 1).font = SECTION_FONT;
      ws.getCell(r, 1).fill = SECTION_FILL;
      for (let c = 2; c <= colCount; c++) ws.getCell(r, c).fill = SECTION_FILL;
      r++;
      const matHeaders = ['Material', 'Unit Cost ($/kg)', 'Gross Usage (kg)', 'Net Usage (kg)', 'Scrap %', 'Reclaim Rate ($/kg)', 'Overhead %',
        'Gross Mat. Cost ($)', 'Reclaim Value ($)', 'Net Mat. Cost ($)', 'Scrap Adj. ($)', 'Overhead Cost ($)', 'Total Cost ($)'];
      matHeaders.forEach((h, i) => {
        const cell = ws.getCell(r, i + 1);
        cell.value = h; cell.font = HEADER_FONT; cell.fill = HEADER_FILL;
      });
      r++;
      const matFirstRow = r;
      cost.materialLines.forEach((m: MaterialLine, i: number) => {
        const label = m.materialDescription ? `${m.materialName} (${m.materialDescription})` : m.materialName;
        ws.getCell(r, 1).value = label;

        // Inputs (editable, blue)
        const inputCell = (col: number, value: number, fmt: string) => {
          const cell = ws.getCell(r, col);
          cell.value = value; cell.numFmt = fmt; cell.fill = INPUT_FILL; cell.font = INPUT_FONT;
        };
        inputCell(2, m.unitCost, CURRENCY_FMT);
        inputCell(3, m.grossUsage, '#,##0.0000');
        inputCell(4, m.netUsage, '#,##0.0000');
        inputCell(5, m.scrap, '0.00"%"');
        inputCell(6, m.reclaimRate, CURRENCY_FMT);
        inputCell(7, m.overhead, '0.00"%"');

        // Formulas (black) — real 8-step chain, each referencing the row above
        const B = colLetter(2), C = colLetter(3), D = colLetter(4), E = colLetter(5), F = colLetter(6), G = colLetter(7);
        const H = colLetter(8), I = colLetter(9), J = colLetter(10), K = colLetter(11), L = colLetter(12);
        const formulaCell = (col: number, formula: string, fmt: string) => {
          const cell = ws.getCell(r, col);
          cell.value = { formula } as ExcelJS.CellFormulaValue; cell.numFmt = fmt;
        };
        formulaCell(8,  `${C}${r}*${B}${r}`, CURRENCY_FMT);                          // Gross Material Cost
        formulaCell(9,  `(${C}${r}-${D}${r})*${F}${r}`, CURRENCY_FMT);               // Reclaim Value
        formulaCell(10, `${H}${r}-${I}${r}`, CURRENCY_FMT);                          // Net Material Cost
        formulaCell(11, `${J}${r}*(${E}${r}/100)`, CURRENCY_FMT);                    // Scrap Adjustment
        formulaCell(12, `(${J}${r}+${K}${r})*(${G}${r}/100)`, CURRENCY_FMT);         // Overhead Cost
        formulaCell(13, `${J}${r}+${K}${r}+${L}${r}`, CURRENCY_FMT);                 // Total Cost
        ws.getCell(r, 13).font = { bold: true };

        if (i % 2 === 1) { for (let c = 1; c <= 13; c++) if (!ws.getCell(r, c).fill) ws.getCell(r, c).fill = SECTION_FILL; }
        r++;
      });
      const matLastRow = r - 1;
      matTotalRange = `M${matFirstRow}:M${matLastRow}`;
      r++;
    }

    // ── Cost Summary by Process — formula-driven ─────────────────────────────────
    ws.mergeCells(r, 1, r, colCount);
    ws.getCell(r, 1).value = 'Cost Summary by Process (editable — change any blue cell)';
    ws.getCell(r, 1).font = SECTION_FONT;
    ws.getCell(r, 1).fill = SECTION_FILL;
    for (let c = 2; c <= colCount; c++) ws.getCell(r, c).fill = SECTION_FILL;
    r++;

    // Process name row sits ABOVE the machine row — same convention as the
    // on-screen Direct Process Costs panel ("Laser Cut" as the primary label,
    // "Salvagnini L3-40 3KW Fiber" as the specific machine underneath it).
    const processRow = r;
    ws.getCell(processRow, 1).value = 'Process';
    ws.getCell(processRow, 1).font = HEADER_FONT; ws.getCell(processRow, 1).fill = HEADER_FILL;
    ws.getCell(processRow, 2).fill = HEADER_FILL;
    ws.getCell(processRow, 3).fill = HEADER_FILL;
    lines.forEach((l, i) => {
      const cell = ws.getCell(processRow, 4 + i);
      cell.value = l.operation ?? l.processGroup ?? `Op ${l.opNbr}`;
      cell.font = HEADER_FONT; cell.fill = HEADER_FILL;
    });
    r++;

    const headerRow = r;
    const headers = ['Cost Element', 'Part Total', 'Material Stock', ...lines.map((l) => l.machineName ?? l.operation ?? `Op ${l.opNbr}`)];
    headers.forEach((h, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = h; cell.font = HEADER_FONT; cell.fill = HEADER_FILL;
    });
    r++;
    const opRow = r;
    ws.getCell(opRow, 1).value = 'Op # / Labour Type';
    ws.getCell(opRow, 1).font = { italic: true, size: 8, color: { argb: 'FF9CA3AF' } };
    lines.forEach((l, i) => {
      const cell = ws.getCell(opRow, 4 + i);
      cell.value = `${l.opNbr}${l.laborType ? ' · ' + l.laborType : ''}`;
      cell.font = { italic: true, size: 8, color: { argb: 'FF9CA3AF' } };
    });
    r++;

    const subHeader = (label: string) => {
      ws.getCell(r, 1).value = label;
      ws.getCell(r, 1).font = { bold: true, size: 9 };
      r++;
    };

    // Row-index tracker — captures each row number as it's written so later
    // formula rows can reference it by cell address (e.g. `${col}${rows.cycleTimeHr}`).
    const rows: Record<string, number> = {};

    const inputRow = (key: string, label: string, value: (l: ProcessLine) => number, fmt: string, sumTotal = true) => {
      rows[key] = r;
      ws.getCell(r, 1).value = label;
      if (sumTotal) {
        ws.getCell(r, 2).value = { formula: `SUM(${colLetter(4)}${r}:${colLetter(colCount)}${r})` } as ExcelJS.CellFormulaValue;
        ws.getCell(r, 2).numFmt = fmt;
      }
      lines.forEach((l, i) => {
        const cell = ws.getCell(r, 4 + i);
        cell.value = value(l); cell.numFmt = fmt; cell.fill = INPUT_FILL; cell.font = INPUT_FONT;
      });
      for (let c = 1; c <= colCount; c++) ws.getCell(r, c).border = THIN_BORDER;
      r++;
    };

    const formulaRow = (
      key: string,
      label: string,
      perCol: (colL: string) => string,
      fmt: string,
      opts: { bold?: boolean; sumTotal?: boolean } = {},
    ) => {
      rows[key] = r;
      ws.getCell(r, 1).value = label;
      if (opts.sumTotal !== false) {
        ws.getCell(r, 2).value = { formula: `SUM(${colLetter(4)}${r}:${colLetter(colCount)}${r})` } as ExcelJS.CellFormulaValue;
        ws.getCell(r, 2).numFmt = fmt;
      }
      lines.forEach((_l, i) => {
        const cl = colLetter(4 + i);
        const cell = ws.getCell(r, 4 + i);
        cell.value = { formula: perCol(cl) } as ExcelJS.CellFormulaValue;
        cell.numFmt = fmt;
      });
      for (let c = 1; c <= colCount; c++) {
        ws.getCell(r, c).border = THIN_BORDER;
        if (opts.bold) ws.getCell(r, c).font = { bold: true };
      }
      r++;
    };

    subHeader('Manufacturing Times & Batch');
    inputRow('cycleTimeHr', 'Cycle Time (hr)', (l) => l.cycleTimeSec / 3600, '#,##0.0000');
    inputRow('setupTimeHr', 'Setup Time (hr)', (l) => l.setupTimeMin / 60, '#,##0.0000');
    inputRow('batchSize', 'Batch Size', (l) => l.batchSize, '#,##0', false);
    inputRow('partsPerCycle', 'Parts / Cycle', (l) => l.partsPerCycle, '#,##0', false);
    inputRow('heads', 'Heads (run)', (l) => l.heads, '#,##0', false);
    inputRow('setupManning', 'Setup Manning', (l) => l.setupManning, '#,##0', false);
    inputRow('scrapPct', 'Scrap %', (l) => l.scrap, '0.00"%"', false);
    r++;

    subHeader('Manufacturing Rates (USD / hr)');
    inputRow('machineRate', 'Machine Rate ($/hr)', (l) => l.machineRate, CURRENCY_FMT, false);
    inputRow('laborRate', 'Labour Rate ($/hr)', (l) => l.laborRate, CURRENCY_FMT, false);
    r++;

    subHeader('Cost Summary (USD)');
    if (matTotalRange) {
      rows.rawMaterialCost = r;
      ws.getCell(r, 1).value = 'Raw Material Cost';
      ws.getCell(r, 2).value = { formula: `SUM(${matTotalRange})` } as ExcelJS.CellFormulaValue;
      ws.getCell(r, 2).numFmt = CURRENCY_FMT;
      ws.getCell(r, 3).value = { formula: `SUM(${matTotalRange})` } as ExcelJS.CellFormulaValue;
      ws.getCell(r, 3).numFmt = CURRENCY_FMT;
      for (let c = 1; c <= colCount; c++) ws.getCell(r, c).border = THIN_BORDER;
      r++;
    }

    // Labour Cost = CycleTimeHr × LaborRate × Heads / PartsPerCycle
    formulaRow('laborCost', 'Labour Cost', (c) =>
      `${c}${rows.cycleTimeHr}*${c}${rows.laborRate}*${c}${rows.heads}/${c}${rows.partsPerCycle}`, CURRENCY_FMT);
    // Machine/Direct Cost = CycleTimeHr × MachineRate / PartsPerCycle
    formulaRow('machineCost', 'Machine / Direct Cost', (c) =>
      `${c}${rows.cycleTimeHr}*${c}${rows.machineRate}/${c}${rows.partsPerCycle}`, CURRENCY_FMT);
    // Amortized Batch Setup = SetupTimeHr × (MachineRate + LaborRate × SetupManning) / BatchSize
    formulaRow('setupCost', 'Amortized Batch Setup', (c) =>
      `${c}${rows.setupTimeHr}*(${c}${rows.machineRate}+${c}${rows.laborRate}*${c}${rows.setupManning})/${c}${rows.batchSize}`, CURRENCY_FMT);
    // Scrap/Yield Adjustment = (Labour + Machine + Setup) × Scrap%
    formulaRow('scrapAdj', 'Scrap / Yield Adjustment', (c) =>
      `(${c}${rows.laborCost}+${c}${rows.machineCost}+${c}${rows.setupCost})*(${c}${rows.scrapPct}/100)`, CURRENCY_FMT);
    // Total Process Cost = sum of the four rows above
    formulaRow('totalProcessCost', 'Total Process Cost / part', (c) =>
      `${c}${rows.laborCost}+${c}${rows.machineCost}+${c}${rows.setupCost}+${c}${rows.scrapAdj}`, CURRENCY_FMT, { bold: true });
    r++;

    // Part-level rollups — tooling/packaging/procured parts aren't broken into
    // per-process editable components in this engine, so these stay as real
    // static pass-through totals (not a fabricated per-process split).
    const staticRow = (label: string, value: number, bold = false) => {
      ws.getCell(r, 1).value = label;
      ws.getCell(r, 2).value = value; ws.getCell(r, 2).numFmt = CURRENCY_FMT;
      for (let c = 1; c <= colCount; c++) { ws.getCell(r, c).border = THIN_BORDER; if (bold) ws.getCell(r, c).font = { bold: true }; }
      r++;
    };
    staticRow('Tooling & Fixture Cost', cost.toolingCost);
    staticRow('Packaging & Logistics Cost', cost.packagingCost);
    staticRow('Procured Parts Cost', cost.procuredPartCost);

    // Addresses of the three static rows just written, for the Manufacturing
    // Cost formula below.
    const toolingAddr = `B${r - 3}`, packagingAddr = `B${r - 2}`, procuredAddr = `B${r - 1}`;
    // No material lines on this part → omit that term entirely rather than
    // falling back to "this row's own address", which would create a
    // self-referential (circular) formula once rows.manufacturingCost is set below.
    const rawMaterialTerm = rows.rawMaterialCost != null ? `B${rows.rawMaterialCost}+` : '';

    rows.manufacturingCost = r;
    ws.getCell(r, 1).value = 'Fully Burdened Manufacturing Cost';
    ws.getCell(r, 2).value = {
      formula: `${rawMaterialTerm}B${rows.totalProcessCost}+${toolingAddr}+${packagingAddr}+${procuredAddr}`,
    } as ExcelJS.CellFormulaValue;
    ws.getCell(r, 2).numFmt = CURRENCY_FMT;
    for (let c = 1; c <= colCount; c++) { ws.getCell(r, c).border = THIN_BORDER; ws.getCell(r, c).font = { bold: true }; }
    r++;

    // SGA% / Margin% — real effective rates (sgaCost/manufacturingCost), shown
    // as editable inputs; SGA $ / Margin $ / Selling Price recalculate live.
    const sgaPctReal    = cost.manufacturingCost > 0 ? (cost.sgaCost    / cost.manufacturingCost) * 100 : 0;
    const marginPctReal = cost.manufacturingCost > 0 ? (cost.profitCost / cost.manufacturingCost) * 100 : 0;

    rows.sgaPct = r;
    ws.getCell(r, 1).value = 'SGA %';
    ws.getCell(r, 2).value = sgaPctReal; ws.getCell(r, 2).numFmt = '0.00"%"';
    ws.getCell(r, 2).fill = INPUT_FILL; ws.getCell(r, 2).font = INPUT_FONT;
    r++;
    rows.marginPct = r;
    ws.getCell(r, 1).value = 'Margin %';
    ws.getCell(r, 2).value = marginPctReal; ws.getCell(r, 2).numFmt = '0.00"%"';
    ws.getCell(r, 2).fill = INPUT_FILL; ws.getCell(r, 2).font = INPUT_FONT;
    r++;

    ws.getCell(r, 1).value = 'SGA Cost';
    ws.getCell(r, 2).value = { formula: `B${rows.manufacturingCost}*(B${rows.sgaPct}/100)` } as ExcelJS.CellFormulaValue;
    ws.getCell(r, 2).numFmt = CURRENCY_FMT;
    const sgaCostRow = r; r++;

    ws.getCell(r, 1).value = 'Margin / Profit';
    ws.getCell(r, 2).value = { formula: `B${rows.manufacturingCost}*(B${rows.marginPct}/100)` } as ExcelJS.CellFormulaValue;
    ws.getCell(r, 2).numFmt = CURRENCY_FMT;
    const marginCostRow = r; r++;

    ws.getCell(r, 1).value = 'Selling Price';
    ws.getCell(r, 2).value = { formula: `B${rows.manufacturingCost}+B${sgaCostRow}+B${marginCostRow}` } as ExcelJS.CellFormulaValue;
    ws.getCell(r, 2).numFmt = CURRENCY_FMT;
    for (let c = 1; c <= colCount; c++) { ws.getCell(r, c).border = THIN_BORDER; ws.getCell(r, c).font = { bold: true }; }
    r++;

    // Freeze columns only — see prior note: freezing rows anchored this far
    // down the sheet pins a region tall enough to break scrolling entirely.
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 0 }];
  }

  // ── Sheet 2: Process Calculation Detail — live CAD-driven verification ──────
  // One block per process: real feature breakdown (cut length, pierce count,
  // bend count, tap specs, inspection checks — whatever the CAD geometry
  // actually produced) and the full calculation trace (real inputs with
  // provenance, then formula steps with the real DB formula string), straight
  // from the same computeCostSummary() the on-screen panel renders. This is a
  // reference/audit sheet, not a second formula-editable model — cycle time
  // here comes from physics calculators that can't be reduced to a spreadsheet
  // formula, which is exactly why this exists: so the number can be verified
  // against its real inputs instead of taken on faith.
  private buildCalculationDetailSheet(
    wb: ExcelJS.Workbook,
    item: BomItemHeaderFields,
    liveSummary: CostSummaryDto | null,
    liveSummaryError: string | null,
  ) {
    const ws = wb.addWorksheet('Process Calculation Detail');
    ws.columns = [{ width: 32 }, { width: 14 }, { width: 12 }, { width: 46 }, { width: 30 }];

    const partLabel = [item.name ?? item.description, item.part_number].filter(Boolean).join('  ·  ') || 'Part';
    ws.mergeCells(1, 1, 1, 5);
    ws.getCell(1, 1).value = partLabel;
    ws.getCell(1, 1).font = { bold: true, size: 10, color: { argb: 'FF374151' } };
    ws.mergeCells(2, 1, 2, 5);
    ws.getCell(2, 1).value = 'Live CAD calculation reference — recomputed fresh from geometry for verification. '
      + 'May differ from Sheet 1 if the applied route was manually edited after costing.';
    ws.getCell(2, 1).font = { italic: true, size: 8, color: { argb: 'FF9CA3AF' } };
    ws.getRow(2).height = 24;
    ws.getCell(2, 1).alignment = { wrapText: true, vertical: 'middle' };
    let r = 4;

    if (!liveSummary) {
      ws.getCell(r, 1).value = liveSummaryError ?? 'Live calculation unavailable.';
      ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF9CA3AF' } };
      return;
    }
    if (liveSummary.scenarioReady === false) {
      ws.getCell(r, 1).value = `Scenario not ready — missing: ${(liveSummary.missingInputs ?? []).join(', ') || 'unknown'}`;
      ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF9CA3AF' } };
      return;
    }

    const lines = liveSummary.processLines ?? [];
    for (const line of lines) {
      // ── Process header bar ────────────────────────────────────────────────
      ws.mergeCells(r, 1, r, 5);
      const head = ws.getCell(r, 1);
      head.value = `${line.operation ?? line.process}  —  ${line.machineName ?? line.machineClass}  ·  `
        + `${(line.cycleTimeMin * 60).toFixed(1)}s  ·  ${CURRENCY_FMT.replace('#,##0.00', '')}${line.totalCost.toFixed(2)}`;
      head.font = HEADER_FONT; head.fill = HEADER_FILL;
      for (let c = 2; c <= 5; c++) ws.getCell(r, c).fill = HEADER_FILL;
      r++;

      // Rate/confidence strip
      ws.getCell(r, 1).value = 'Machine Rate';
      ws.getCell(r, 2).value = line.hourlyRate; ws.getCell(r, 2).numFmt = CURRENCY_FMT;
      ws.getCell(r, 3).value = 'Labour Rate';
      ws.getCell(r, 4).value = line.labourRate ?? null; if (ws.getCell(r, 4).value != null) ws.getCell(r, 4).numFmt = CURRENCY_FMT;
      ws.getCell(r, 5).value = line.confidence ? `Confidence: ${line.confidence}` : '';
      r++;

      // ── Feature breakdown — real per-feature time contributors ──────────────
      const features: FeatureOp[] = line.featureBreakdown ?? [];
      if (features.length > 0) {
        ws.getCell(r, 1).value = 'Feature Breakdown';
        ws.getCell(r, 1).font = { bold: true, size: 9 };
        r++;
        ['Feature', 'Count', 'Time (s)', 'Feature Type'].forEach((h, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = h; cell.font = { bold: true, size: 9 }; cell.fill = SECTION_FILL;
        });
        r++;
        for (const f of features) {
          ws.getCell(r, 1).value = f.name;
          ws.getCell(r, 2).value = f.count;
          ws.getCell(r, 3).value = f.timeSec; ws.getCell(r, 3).numFmt = '#,##0.00';
          ws.getCell(r, 4).value = f.featureType;
          r++;
        }
      }

      // ── Calculation trace — real inputs (with provenance) then formula
      // steps (with the real DB formula string), in evaluation order ─────────
      const trace: CalculationTraceStep[] = line.calculationTrace ?? [];
      if (trace.length > 0) {
        ws.getCell(r, 1).value = 'Calculation Trace';
        ws.getCell(r, 1).font = { bold: true, size: 9 };
        if (line.calculatorId) {
          ws.getCell(r, 3).value = `Calculator v${line.calculatorVersion ?? 1}`;
          ws.getCell(r, 3).font = { italic: true, size: 8, color: { argb: 'FF9CA3AF' } };
        }
        r++;
        ['Step', 'Value', 'Unit', 'Formula / Source', 'Type'].forEach((h, i) => {
          const cell = ws.getCell(r, i + 1);
          cell.value = h; cell.font = { bold: true, size: 9 }; cell.fill = SECTION_FILL;
        });
        r++;
        for (const step of trace) {
          ws.getCell(r, 1).value = step.displayLabel;
          ws.getCell(r, 2).value = step.value ?? '—';
          ws.getCell(r, 3).value = step.unit ?? '';
          ws.getCell(r, 4).value = step.formula ?? step.source ?? '';
          ws.getCell(r, 4).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
          ws.getCell(r, 5).value = step.kind === 'input' ? (step.stepType ?? 'input') : (step.stepType ?? 'calculated');
          r++;
        }
      } else if (line.physicsGap) {
        const gap = line.physicsGap;
        ws.getCell(r, 1).value = 'Result unavailable';
        ws.getCell(r, 1).font = { italic: true, color: { argb: 'FFB91C1C' } };
        ws.getCell(r, 2).value = gap.gapType === 'missing_lookup' ? gap.requiredAction : gap.reason;
        r++;
      }

      r += 2; // gap between process blocks
    }
  }
}
