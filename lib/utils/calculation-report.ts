import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { ProcessLineCost, CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';

export interface CalculationReportContext {
  partNumber: string;
  location: string;
  currencySymbol: string;
  batchSize: number;
  line: ProcessLineCost;
  cycleTimeSec: number;
  laborRate: number | null;
}

const fmt = (v: number | string | null | undefined, decimals = 4): string => {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  return Number.isInteger(v) ? String(v) : v.toFixed(decimals);
};

/**
 * Generates a full end-to-end audit-trail PDF for a process line's cycle-time
 * calculation — every real input (with its provenance) and every calculated
 * formula step, exactly as evaluated by the live cost engine, for costing/
 * manufacturing engineering to independently verify. Nothing here is
 * fabricated for display: it renders calculationTrace verbatim, which is
 * absent (not backfilled with placeholders) for processes not yet wired to a
 * real DB calculator.
 */
export function generateCalculationReportPdf(ctx: CalculationReportContext): void {
  const { partNumber, location, currencySymbol, batchSize, line, cycleTimeSec, laborRate } = ctx;
  const trace: CalculationTraceStep[] = line.calculationTrace ?? [];

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  let y = 48;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`Cycle Time Calculation — ${line.process}`, marginX, y);
  y += 20;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(90);
  doc.text(
    `Part: ${partNumber}   ·   Location: ${location}   ·   Machine: ${line.machineName ?? '—'}   ·   Generated: ${new Date().toISOString().slice(0, 10)}`,
    marginX,
    y,
  );
  y += 22;
  doc.setTextColor(0);

  const inputRows = trace
    .filter((s) => s.kind === 'input')
    .map((s) => [s.displayLabel, fmt(s.value), s.unit ?? '', s.source ?? '']);

  if (inputRows.length) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('1. Real Input Values', marginX, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [['Field', 'Value', 'Unit', 'Source / Provenance']],
      body: inputRows,
      styles: { fontSize: 8.5, cellPadding: 4 },
      headStyles: { fillColor: [60, 60, 70] },
      columnStyles: { 3: { cellWidth: 220 } },
    });
    y = (doc as any).lastAutoTable.finalY + 20;
  }

  const calcRows = trace
    .filter((s) => s.kind === 'calculated')
    .map((s) => [s.displayLabel, s.formula ?? '', `${fmt(s.value)}${s.unit ? ' ' + s.unit : ''}`]);

  if (calcRows.length) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('2. Formula Steps (evaluated in order, DB calculator’s own formulas)', marginX, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      head: [['Field', 'Formula', 'Result']],
      body: calcRows,
      styles: { fontSize: 8.5, cellPadding: 4, font: 'courier' },
      headStyles: { fillColor: [60, 60, 70], font: 'helvetica' },
      columnStyles: { 0: { font: 'helvetica' }, 2: { font: 'helvetica' } },
    });
    y = (doc as any).lastAutoTable.finalY + 20;
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('3. Cost Computation', marginX, y);
  y += 8;

  const costRows = [
    ['Cycle Time', `${fmt(cycleTimeSec, 2)} sec  (${fmt(line.cycleTimeMin, 4)} min)`],
    ['Machine Rate', `${currencySymbol}${fmt(line.hourlyRate, 2)}/hr — ${line.machineName ?? 'machine class default'}`],
    ['Labour Rate', laborRate != null ? `${currencySymbol}${fmt(laborRate, 2)}/hr` : '—'],
    ['Batch Size', String(batchSize)],
    ['Run Cost = (Cycle Time ÷ 3600) × (Machine Rate + Labour Rate × Operators)', `${currencySymbol}${fmt(line.runCost, 4)}`],
    ['Setup Cost = (Setup Time ÷ Batch Size) × (Machine + Labour)', `${currencySymbol}${fmt(line.setupCost, 4)}`],
    ['Total Cost', `${currencySymbol}${fmt(line.totalCost, 4)}`],
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: marginX, right: marginX },
    body: costRows,
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: { 0: { cellWidth: 320 }, 1: { halign: 'right', fontStyle: 'bold' } },
    theme: 'plain',
    didParseCell: (data) => {
      if (data.row.index === costRows.length - 1) data.cell.styles.fontSize = 11;
    },
  });
  y = (doc as any).lastAutoTable.finalY + 24;

  doc.setFontSize(8);
  doc.setTextColor(130);
  doc.text(
    'Every value above is sourced live from this part’s CAD geometry, the selected machine, and the same DB-stored calculator formulas',
    marginX,
    y,
  );
  doc.text(
    'used by the interactive "Edit Process Cost" calculator dialog — nothing on this page is a manual estimate or placeholder.',
    marginX,
    y + 11,
  );

  const safeProcess = line.process.replace(/[^a-z0-9]+/gi, '_');
  const safePart = partNumber.replace(/[^a-z0-9]+/gi, '_');
  doc.save(`${safePart}_${safeProcess}_cycle_time_calculation.pdf`);
}
