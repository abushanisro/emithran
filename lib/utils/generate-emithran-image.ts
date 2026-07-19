import type { BomItemCostAnalysis } from '@/lib/api/hooks/useCostAnalysis';
import type { PartInfo } from './generate-emithran-pdf';

// ── Formatting ────────────────────────────────────────────────────────────────
const rs = (v: number) =>
  `Rs.${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pct = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '0.0%';

// ── Inline-style helpers ──────────────────────────────────────────────────────
const s = (obj: Record<string, string | number>) =>
  Object.entries(obj).map(([k, v]) => `${k.replace(/([A-Z])/g, '-$1').toLowerCase()}:${v}`).join(';');

const th = (text: string) =>
  `<th style="${s({ padding: '8px 10px', textAlign: 'left', fontWeight: '700', fontSize: '12px', color: '#fff', backgroundColor: '#1a1a1a', borderBottom: '2px solid #1a1a1a' })}">${text}</th>`;

const thR = (text: string) =>
  `<th style="${s({ padding: '8px 10px', textAlign: 'right', fontWeight: '700', fontSize: '12px', color: '#fff', backgroundColor: '#1a1a1a', borderBottom: '2px solid #1a1a1a' })}">${text}</th>`;

const td = (text: string, right = false, bold = false, bg = '') =>
  `<td style="${s({ padding: '7px 10px', fontSize: '12px', textAlign: right ? 'right' : 'left', fontWeight: bold ? '700' : '400', backgroundColor: bg || '#fff', borderBottom: '1px solid #eee', color: '#282828' })}">${text}</td>`;

const tdFoot = (text: string, right = false) =>
  `<td style="${s({ padding: '7px 10px', fontSize: '12px', textAlign: right ? 'right' : 'left', fontWeight: '700', backgroundColor: '#f3f3f3', borderBottom: '1px solid #ddd', color: '#1a1a1a' })}">${text}</td>`;

const tableWrap = (content: string) =>
  `<table style="${s({ width: '100%', borderCollapse: 'collapse', marginBottom: '0' })}">${content}</table>`;

const sectionTitle = (title: string) =>
  `<div style="${s({ fontWeight: '700', fontSize: '13px', color: '#1a1a1a', margin: '20px 0 6px', letterSpacing: '0.05em' })}">${title}</div>`;

// ── Build the HTML report string ──────────────────────────────────────────────
function buildHtml(analysis: BomItemCostAnalysis, part: PartInfo): string {
  const today = new Date().toLocaleDateString('en-US', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const mfg = analysis.manufacturingCost;

  // thumbnail
  const thumbHtml = part.thumbnailUrl
    ? `<img src="${part.thumbnailUrl}" style="${s({ width: '80px', height: '80px', objectFit: 'contain', border: '1px solid #e5e7eb', borderRadius: '4px', backgroundColor: '#f9f9f9', marginRight: '20px', flexShrink: '0' })}" />`
    : '';

  // cost summary rows
  const summaryRows = (
    [
      ['Raw Materials',         rs(analysis.rawMaterialCost),  pct(analysis.rawMaterialCost,  mfg)],
      ['Process Costs',         rs(analysis.processCost),      pct(analysis.processCost,      mfg)],
      ['Tooling & Fixtures',    rs(analysis.toolingCost),      pct(analysis.toolingCost,      mfg)],
      ['Packaging & Logistics', rs(analysis.packagingCost),    pct(analysis.packagingCost,    mfg)],
      ['Procured Parts',        rs(analysis.procuredPartCost), pct(analysis.procuredPartCost, mfg)],
    ] as [string, string, string][]
  ).map(([c0, c1, c2], i) =>
    `<tr>${td(c0, false, false, i % 2 ? '#fafafa' : '#fff')}${td(c1, true, false, i % 2 ? '#fafafa' : '#fff')}${td(c2, true, false, i % 2 ? '#fafafa' : '#fff')}</tr>`,
  ).join('');

  const summaryFoot = (
    [
      ['Total Mfg Cost',  rs(mfg),                   '100%'],
      ['SGA (12.5%)',      rs(analysis.sgaCost),      ''],
      ['Profit (8%)',      rs(analysis.profitCost),   ''],
      ['Selling Price',   rs(analysis.sellingPrice), ''],
    ] as [string, string, string][]
  ).map(([c0, c1, c2]) =>
    `<tr>${tdFoot(c0)}${tdFoot(c1, true)}${tdFoot(c2, true)}</tr>`,
  ).join('');

  // cost drivers
  const driversRows = analysis.costDrivers.map((d, i) =>
    `<tr>
      ${td(`${i + 1}`, true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(d.label, false, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(d.category.replace(/_/g, ' '), false, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(rs(d.costPerPart), true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(`${d.pctOfMfgCost.toFixed(1)}%`, true, false, i % 2 ? '#fafafa' : '#fff')}
    </tr>`,
  ).join('');

  // process rows
  const processRows = analysis.processLines.map((l, i) =>
    `<tr>
      ${td(l.opNbr?.toString() ?? '', true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(l.operation ?? '', false, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(l.processGroup ?? '', false, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(l.cycleTimeSec.toFixed(0), true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(l.machineRate.toFixed(0), true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(l.laborRate.toFixed(0), true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(l.setupCostPerPart.toFixed(4), true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(l.cycleCostPerPart.toFixed(4), true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(l.totalCostPerPart.toFixed(4), true, false, i % 2 ? '#fafafa' : '#fff')}
    </tr>`,
  ).join('');

  const processFoot =
    `<tr>${['', '', '', '', '', '', '', 'Total', rs(analysis.processCost)].map((c, i) => tdFoot(c, i >= 7)).join('')}</tr>`;

  // material rows
  const matRows = analysis.materialLines.map((m, i) =>
    `<tr>
      ${td(m.materialName, false, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(m.materialDescription ?? '—', false, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(m.netUsage.toFixed(4), true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(m.grossUsage.toFixed(4), true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(`${m.scrap.toFixed(0)}%`, true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(m.unitCost.toFixed(2), true, false, i % 2 ? '#fafafa' : '#fff')}
      ${td(rs(m.totalCost), true, false, i % 2 ? '#fafafa' : '#fff')}
    </tr>`,
  ).join('');

  const matFoot =
    `<tr>${['', '', '', '', '', 'Total', rs(analysis.rawMaterialCost)].map((c, i) => tdFoot(c, i >= 5)).join('')}</tr>`;

  return `
<div style="${s({ fontFamily: 'Arial,Helvetica,sans-serif', background: '#fff', color: '#1a1a1a', padding: '40px', width: '860px', boxSizing: 'border-box' })}">

  <!-- Header -->
  <div style="${s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' })}">
    <span style="${s({ fontSize: '22px', fontWeight: '700', color: '#1a1a1a' })}">EMithran</span>
    <div style="${s({ textAlign: 'right', fontSize: '11px', color: '#777', lineHeight: '1.6' })}">
      <div>${today}</div>
      <div>A-Priori Cost Estimate Report</div>
    </div>
  </div>
  <hr style="${s({ border: 'none', borderTop: '1px solid #ddd', margin: '0 0 18px' })}">

  <!-- Part info -->
  <div style="${s({ display: 'flex', alignItems: 'flex-start', marginBottom: '16px' })}">
    ${thumbHtml}
    <div style="${s({ flex: '1' })}">
      <div style="${s({ fontSize: '17px', fontWeight: '700', color: '#1a1a1a', marginBottom: '4px' })}">${part.partName ?? part.partNumber ?? 'Part'}</div>
      ${part.partNumber ? `<div style="${s({ fontSize: '12px', color: '#666', marginBottom: '2px' })}">PN: ${part.partNumber}</div>` : ''}
      ${part.material ? `<div style="${s({ fontSize: '12px', color: '#666', marginBottom: '12px' })}">Material: ${part.material}</div>` : ''}
      <div style="${s({ display: 'flex', gap: '40px', marginTop: '10px' })}">
        <div>
          <div style="${s({ fontSize: '10px', color: '#888', letterSpacing: '0.06em', marginBottom: '3px' })}">MFG COST</div>
          <div style="${s({ fontSize: '18px', fontWeight: '700', color: '#2563eb' })}">${rs(mfg)}</div>
        </div>
        <div>
          <div style="${s({ fontSize: '10px', color: '#888', letterSpacing: '0.06em', marginBottom: '3px' })}">SELLING PRICE</div>
          <div style="${s({ fontSize: '18px', fontWeight: '700', color: '#16a34a' })}">${rs(analysis.sellingPrice)}</div>
        </div>
      </div>
    </div>
  </div>
  <hr style="${s({ border: 'none', borderTop: '1px solid #ddd', margin: '0 0 18px' })}">

  <!-- Cost Summary -->
  ${sectionTitle('COST SUMMARY')}
  ${tableWrap(`
    <thead><tr>${th('Cost Element')}${thR('Rs. / Part')}${thR('% Mfg Cost')}</tr></thead>
    <tbody>${summaryRows}</tbody>
    <tfoot>${summaryFoot}</tfoot>
  `)}

  <!-- Top Cost Drivers -->
  ${analysis.costDrivers.length > 0 ? `
  ${sectionTitle('TOP COST DRIVERS')}
  ${tableWrap(`
    <thead><tr>${th('#')}${th('Driver')}${th('Category')}${thR('Rs. / Part')}${thR('% Mfg Cost')}</tr></thead>
    <tbody>${driversRows}</tbody>
  `)}` : ''}

  <!-- Process Cost Breakdown -->
  ${analysis.processLines.length > 0 ? `
  ${sectionTitle('PROCESS COST BREAKDOWN')}
  ${tableWrap(`
    <thead><tr>${th('Op#')}${th('Operation')}${th('Group')}${thR('Cycle (s)')}${thR('MHR')}${thR('LHR')}${thR('Setup/part')}${thR('Cycle/part')}${thR('Total/part')}</tr></thead>
    <tbody>${processRows}</tbody>
    <tfoot>${processFoot}</tfoot>
  `)}` : ''}

  <!-- Raw Material Breakdown -->
  ${analysis.materialLines.length > 0 ? `
  ${sectionTitle('RAW MATERIAL BREAKDOWN')}
  ${tableWrap(`
    <thead><tr>${th('Material')}${th('Grade / Spec')}${thR('Net (kg)')}${thR('Gross (kg)')}${thR('Scrap %')}${thR('Rs./kg')}${thR('Total/part')}</tr></thead>
    <tbody>${matRows}</tbody>
    <tfoot>${matFoot}</tfoot>
  `)}` : ''}

  <!-- Footer -->
  <hr style="${s({ border: 'none', borderTop: '1px solid #ddd', margin: '24px 0 8px' })}">
  <div style="${s({ fontSize: '10px', color: '#999', textAlign: 'center' })}">EMithran · Confidential · For internal use only</div>
</div>`;
}

// ── Public export ─────────────────────────────────────────────────────────────
export async function generateEMithranImage(
  analysis: BomItemCostAnalysis,
  part: PartInfo,
): Promise<void> {
  const html2canvas = (await import('html2canvas')).default;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:absolute;left:-9999px;top:0;z-index:-1;';
  wrapper.innerHTML = buildHtml(analysis, part);
  document.body.appendChild(wrapper);

  try {
    const canvas = await html2canvas(wrapper.firstElementChild as HTMLElement, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const link = document.createElement('a');
    link.download = `${part.partNumber ?? part.partName ?? 'cost-report'}-EMithran-Report.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } finally {
    document.body.removeChild(wrapper);
  }
}
