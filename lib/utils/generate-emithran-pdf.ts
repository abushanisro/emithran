import type { BomItemCostAnalysis } from '@/lib/api/hooks/useCostAnalysis';

// jsPDF built-in Helvetica does not render ₹ — use Rs. which is universally safe in PDFs
const rs = (v: number) =>
  `Rs.${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '0.0%';

export interface PartInfo {
  partNumber: string | undefined;
  partName: string | undefined;
  material: string | undefined;
  thumbnailUrl: string | undefined;
}

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  dark:  [26,  26,  26]  as [number, number, number],
  gray:  [245, 245, 245] as [number, number, number],
  alt:   [250, 250, 250] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  blue:  [37,  99,  235] as [number, number, number],
  green: [22,  163, 74]  as [number, number, number],
  text:  [40,  40,  40]  as [number, number, number],
  muted: [110, 110, 110] as [number, number, number],
};

// ── Shared autoTable defaults ─────────────────────────────────────────────────
const TABLE_DEFAULTS = {
  showHead: 'everyPage' as const,
  showFoot: 'lastPage'  as const,   // total row only on final page of each table
  styles:        { font: 'helvetica', textColor: C.text },
  headStyles:    { fillColor: C.dark, textColor: C.white, fontStyle: 'bold' as const },
  footStyles:    { fillColor: C.gray, textColor: C.dark,  fontStyle: 'bold' as const },
  bodyStyles:    { fillColor: C.white },
  alternateRowStyles: { fillColor: C.alt },
};

export async function generateEMithranPdf(
  analysis: BomItemCostAnalysis,
  part: PartInfo,
): Promise<void> {
  const { jsPDF }  = await import('jspdf');
  const autoTable  = (await import('jspdf-autotable')).default;

  const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW  = 210;
  const M      = 14;          // margin
  const cW     = pageW - M * 2;
  let   y      = M;

  const lastY  = () => ((doc as any).lastAutoTable?.finalY ?? y) as number;

  // ── Brand header ─────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...C.dark);
  doc.text('EMithran', M, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  const today = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  doc.text(today, pageW - M, y, { align: 'right' });
  doc.text('A-Priori Cost Estimate Report', pageW - M, y + 4, { align: 'right' });

  y += 8;
  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.35);
  doc.line(M, y, pageW - M, y);
  y += 7;

  // ── Part thumbnail + info ────────────────────────────────────────────────────
  let infoX = M;
  const thumbW = 28;

  if (part.thumbnailUrl) {
    try {
      const fmt = part.thumbnailUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
      doc.addImage(part.thumbnailUrl, fmt, M, y, thumbW, thumbW);
      infoX = M + thumbW + 4;
    } catch { /* skip on error */ }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...C.dark);
  doc.text(part.partName ?? part.partNumber ?? 'Part', infoX, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...C.muted);
  let infoY = y + 11;
  if (part.partNumber) { doc.text(`PN: ${part.partNumber}`, infoX, infoY); infoY += 5; }
  if (part.material)   { doc.text(`Material: ${part.material}`, infoX, infoY); }

  // Metric pills
  const pillY = y + (part.thumbnailUrl ? thumbW - 4 : 18);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...C.muted);
  doc.text('MFG COST',     infoX,      pillY);
  doc.text('SELLING PRICE', infoX + 52, pillY);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...C.blue);
  doc.text(rs(analysis.manufacturingCost), infoX, pillY + 6);
  doc.setTextColor(...C.green);
  doc.text(rs(analysis.sellingPrice), infoX + 52, pillY + 6);

  y = Math.max(y + (part.thumbnailUrl ? thumbW : 28), pillY + 12) + 3;
  doc.setDrawColor(210, 210, 210);
  doc.line(M, y, pageW - M, y);
  y += 6;

  // ── Section heading helper ────────────────────────────────────────────────────
  const heading = (title: string) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...C.dark);
    doc.text(title, M, y);
    y += 3;
  };

  // ── 1. Cost Summary ───────────────────────────────────────────────────────────
  const mfg = analysis.manufacturingCost;
  heading('COST SUMMARY');
  autoTable(doc, {
    ...TABLE_DEFAULTS,
    startY: y,
    margin: { left: M, right: M },
    tableWidth: cW,
    head: [['Cost Element', 'Rs. / Part', '% Mfg Cost']],
    body: [
      ['Raw Materials',         rs(analysis.rawMaterialCost),  pct(analysis.rawMaterialCost,  mfg)],
      ['Process Costs',         rs(analysis.processCost),      pct(analysis.processCost,      mfg)],
      ['Tooling & Fixtures',    rs(analysis.toolingCost),      pct(analysis.toolingCost,      mfg)],
      ['Packaging & Logistics', rs(analysis.packagingCost),    pct(analysis.packagingCost,    mfg)],
      ['Procured Parts',        rs(analysis.procuredPartCost), pct(analysis.procuredPartCost, mfg)],
    ],
    foot: [
      ['Total Mfg Cost',  rs(mfg),                   '100%'],
      ['SGA (12.5%)',      rs(analysis.sgaCost),      ''],
      ['Profit (8%)',      rs(analysis.profitCost),   ''],
      ['Selling Price',   rs(analysis.sellingPrice), ''],
    ],
    styles:     { ...TABLE_DEFAULTS.styles, fontSize: 9, cellPadding: 2.8 },
    headStyles: { ...TABLE_DEFAULTS.headStyles, fontSize: 9 },
    footStyles: { ...TABLE_DEFAULTS.footStyles, fontSize: 9 },
    columnStyles: {
      0: { cellWidth: cW * 0.52 },
      1: { cellWidth: cW * 0.28, halign: 'right' },
      2: { cellWidth: cW * 0.20, halign: 'right' },
    },
  });
  y = lastY() + 7;

  // ── 2. Top Cost Drivers ───────────────────────────────────────────────────────
  if (analysis.costDrivers.length > 0) {
    heading('TOP COST DRIVERS');
    autoTable(doc, {
      ...TABLE_DEFAULTS,
      startY: y,
      margin: { left: M, right: M },
      tableWidth: cW,
      head: [['#', 'Driver', 'Category', 'Rs. / Part', '% Mfg Cost']],
      body: analysis.costDrivers.map((d, i) => [
        `${i + 1}`,
        d.label,
        d.category.replace(/_/g, ' '),
        rs(d.costPerPart),
        `${d.pctOfMfgCost.toFixed(1)}%`,
      ]),
      styles:     { ...TABLE_DEFAULTS.styles, fontSize: 9, cellPadding: 2.5 },
      headStyles: { ...TABLE_DEFAULTS.headStyles, fontSize: 9 },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: cW * 0.36 },
        2: { cellWidth: cW * 0.22 },
        3: { cellWidth: cW * 0.22, halign: 'right' },
        4: { cellWidth: cW * 0.20, halign: 'right' },
      },
    });
    y = lastY() + 7;
  }

  // ── 3. Process Cost Breakdown ─────────────────────────────────────────────────
  if (analysis.processLines.length > 0) {
    heading('PROCESS COST BREAKDOWN');
    autoTable(doc, {
      ...TABLE_DEFAULTS,
      startY: y,
      margin: { left: M, right: M },
      tableWidth: cW,
      head: [['Op#', 'Operation', 'Group', 'Cycle (s)', 'MHR', 'LHR', 'Setup/part', 'Cycle/part', 'Total/part']],
      body: analysis.processLines.map(l => [
        l.opNbr?.toString() ?? '',
        l.operation   ?? '',
        l.processGroup ?? '',
        l.cycleTimeSec.toFixed(0),
        l.machineRate.toFixed(0),
        l.laborRate.toFixed(0),
        l.setupCostPerPart.toFixed(4),
        l.cycleCostPerPart.toFixed(4),
        l.totalCostPerPart.toFixed(4),
      ]),
      foot: [
        ['', '', '', '', '', '', '', 'Total', rs(analysis.processCost)],
      ],
      styles:     { ...TABLE_DEFAULTS.styles, fontSize: 7.5, cellPadding: 2 },
      headStyles: { ...TABLE_DEFAULTS.headStyles, fontSize: 7.5 },
      footStyles: { ...TABLE_DEFAULTS.footStyles, fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 11,  halign: 'center' },
        1: { cellWidth: 37 },
        2: { cellWidth: 25 },
        3: { cellWidth: 17, halign: 'right' },
        4: { cellWidth: 17, halign: 'right' },
        5: { cellWidth: 14, halign: 'right' },
        6: { cellWidth: 21, halign: 'right' },
        7: { cellWidth: 21, halign: 'right' },
        8: { cellWidth: 19, halign: 'right' },
      },
    });
    y = lastY() + 7;
  }

  // ── 4. Raw Material Breakdown ─────────────────────────────────────────────────
  if (analysis.materialLines.length > 0) {
    heading('RAW MATERIAL BREAKDOWN');
    autoTable(doc, {
      ...TABLE_DEFAULTS,
      startY: y,
      margin: { left: M, right: M },
      tableWidth: cW,
      head: [['Material', 'Grade / Spec', 'Net (kg)', 'Gross (kg)', 'Scrap %', 'Rs./kg', 'Total/part']],
      body: analysis.materialLines.map(m => [
        m.materialName,
        m.materialDescription ?? '—',
        m.netUsage.toFixed(4),
        m.grossUsage.toFixed(4),
        `${m.scrap.toFixed(0)}%`,
        m.unitCost.toFixed(2),
        rs(m.totalCost),
      ]),
      foot: [['', '', '', '', '', 'Total', rs(analysis.rawMaterialCost)]],
      styles:     { ...TABLE_DEFAULTS.styles, fontSize: 8.5, cellPadding: 2.5 },
      headStyles: { ...TABLE_DEFAULTS.headStyles, fontSize: 8.5 },
      footStyles: { ...TABLE_DEFAULTS.footStyles, fontSize: 8.5 },
      columnStyles: {
        0: { cellWidth: cW * 0.25 },
        1: { cellWidth: cW * 0.18 },
        2: { cellWidth: cW * 0.12, halign: 'right' },
        3: { cellWidth: cW * 0.12, halign: 'right' },
        4: { cellWidth: cW * 0.09, halign: 'right' },
        5: { cellWidth: cW * 0.12, halign: 'right' },
        6: { cellWidth: cW * 0.12, halign: 'right' },
      },
    });
  }

  // ── Remove trailing blank page (jspdf-autotable sometimes adds one) ───────────
  const totalPages = doc.getNumberOfPages();
  if (totalPages > 1) {
    const finalTableY = (doc as any).lastAutoTable?.finalY ?? 0;
    // If the last page's content ends near the top margin, it's a blank overflow page
    doc.setPage(totalPages);
    const cursorY = finalTableY;
    // Heuristic: if final content Y on last page is within top 30 mm, page is effectively blank
    if (cursorY < M + 30) {
      doc.deletePage(totalPages);
    }
  }

  // ── Page footers ──────────────────────────────────────────────────────────────
  const count = doc.getNumberOfPages();
  for (let p = 1; p <= count; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...C.muted);
    doc.setDrawColor(210, 210, 210);
    doc.setLineWidth(0.3);
    doc.line(M, 287, pageW - M, 287);
    doc.text('EMithran  ·  Confidential  ·  For internal use only', M, 291);
    doc.text(`Page ${p} of ${count}`, pageW - M, 291, { align: 'right' });
  }

  doc.save(`${part.partNumber ?? part.partName ?? 'cost-report'}-EMithran-Report.pdf`);
}
