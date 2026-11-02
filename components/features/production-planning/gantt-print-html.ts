import { html, SafeHtml } from '@/lib/utils/escape-html';

// The printable Gantt chart ScheduleView opens in a new window. Operator, task, part and lot names are user-editable, so the
// page is built only through `html`, which escapes every interpolated value: none can turn into markup in the app's origin.

export type GanttViewMode = 'weekly' | 'daily' | 'monthly';

export interface GanttPrintBomItem {
  partNumber?: string | null;
  partName?: string | null;
  requiredQuantity?: number | null;
  consumedQuantity?: number | null;
  unit?: string | null;
  status?: string | null;
}

export interface GanttPrintSubTask {
  name: string;
  operatorName?: string | null;
  status?: string | null;
  estimatedDuration?: number | null;
  actualDuration?: number | null;
  bomRequirements?: GanttPrintBomItem[] | null;
}

export interface GanttPrintInput {
  lotId: string;
  viewMode: GanttViewMode;
  /** Sections in display order, each with its sub-tasks. */
  sections: { name: string; subTasks: GanttPrintSubTask[] }[];
  hasProcesses: boolean;
  showBom: boolean;
  totalTasks: number;
  completedTasks: number;
  now: Date;
}

const COLUMN_COUNT: Record<GanttViewMode, number> = { weekly: 10, daily: 7, monthly: 6 };

const BOM_STATUS_CLASS = new Map([
  ['AVAILABLE', 'bom-available'],
  ['PARTIAL', 'bom-partial'],
  ['SHORTAGE', 'bom-shortage'],
  ['PENDING', 'bom-pending'],
]);

const CELL = 'border: 1px solid #374151; padding: 4px; text-align: center;';
const IDLE = 'background: #f3f4f6; color: #6b7280;';

function dateLabel(viewMode: GanttViewMode, today: Date, i: number): string {
  const d = new Date(today);
  if (viewMode === 'weekly') {
    d.setDate(today.getDate() + i * 7);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (Week ${i + 1})`;
  }
  if (viewMode === 'daily') {
    d.setDate(today.getDate() + i);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (${d.toLocaleDateString('en-US', { weekday: 'short' })})`;
  }
  d.setMonth(today.getMonth() + i);
  return `${d.toLocaleDateString('en-US', { month: 'short' })} (Month ${i + 1})`;
}

/** One timeline cell per column; `active(i)` decides whether the cell is filled and with what class and text. */
function timelineCells(columns: number, fontSize: string, active: (i: number) => { cls: string; text: string } | null): SafeHtml[] {
  return Array.from({ length: columns }, (_, i) => {
    const a = active(i);
    return html`<td class="${a?.cls ?? ''}" style="${CELL} ${a ? '' : IDLE} font-size: ${fontSize};">${a?.text ?? ''}</td>`;
  });
}

function bomRow(bom: GanttPrintBomItem, index: number, columns: number): SafeHtml {
  const required = bom.requiredQuantity ?? 0;
  const consumed = bom.consumedQuantity ?? 0;
  const pct = required > 0 ? Math.min(100, (consumed / required) * 100) : 0;
  const cls = BOM_STATUS_CLASS.get(bom.status ?? '') ?? 'bom-available';
  const cells = timelineCells(columns, '9px', (i) =>
    i < Math.ceil((pct / 100) * columns) || i < 2 ? { cls, text: i === 0 ? (bom.partNumber ?? '') : `${consumed}/${required}` } : null,
  );
  return html`
    <tr>
      <td style="border: 1px solid #e5e7eb; padding: 8px; padding-left: 48px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 16px; height: 16px; background: rgba(59, 130, 246, 0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px;">${index + 1}</div>
          <div style="width: 8px; height: 8px; background: #3b82f6; border-radius: 50%;"></div>
          <div>
            <div style="font-size: 11px; font-weight: 500;">${bom.partNumber ?? 'N/A'}</div>
            <div style="font-size: 9px; color: #6b7280;">${bom.partName ?? 'Unknown Part'} • Qty: ${required}</div>
          </div>
          <span style="background: #f3f4f6; border: 1px solid #d1d5db; padding: 2px 4px; border-radius: 4px; font-size: 9px;">${bom.unit ?? 'pcs'}</span>
        </div>
      </td>
      ${cells}
    </tr>`;
}

function subTaskRows(task: GanttPrintSubTask, index: number, columns: number, showBom: boolean): SafeHtml {
  const pct = task.actualDuration && task.estimatedDuration ? (task.actualDuration / task.estimatedDuration) * 100 : 0;
  const cells = timelineCells(columns, '10px', (i) =>
    i < Math.ceil((pct / 100) * columns) || i < 3 ? { cls: 'subtask-cell', text: i === 0 ? task.name : `${task.actualDuration ?? 0}h` } : null,
  );
  const boms = task.bomRequirements ?? [];
  return html`
    <tr>
      <td style="border: 1px solid #e5e7eb; padding: 8px; padding-left: 24px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 20px; height: 20px; background: #6b7280; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px;">${index + 1}</div>
          <div style="width: 12px; height: 12px; background: #f59e0b; border-radius: 50%;"></div>
          <div>
            <div style="font-size: 12px; font-weight: 500;">${task.name}</div>
            <div style="font-size: 10px; color: #6b7280;">${task.operatorName ?? 'Unassigned'} • ${boms.length} BOM parts</div>
          </div>
          <span style="background: #f3f4f6; border: 1px solid #d1d5db; padding: 2px 6px; border-radius: 4px; font-size: 10px;">${task.status ?? 'PENDING'}</span>
        </div>
      </td>
      ${cells}
    </tr>
    ${showBom ? boms.map((b, i) => bomRow(b, i, columns)) : []}`;
}

function sectionRows(section: GanttPrintInput['sections'][number], index: number, columns: number, showBom: boolean): SafeHtml {
  const title = section.subTasks.length === 0 ? `${section.name} (No tasks)` : section.name;
  const bomParts = section.subTasks.reduce((total, t) => total + (t.bomRequirements?.length ?? 0), 0);
  const cells = timelineCells(columns, '10px', (i) => (i < 3 ? { cls: 'process-cell', text: `Wk ${i + 1}` } : null));
  return html`
    <tr style="background: #f8fafc;">
      <td style="border: 1px solid #e5e7eb; padding: 8px; font-weight: 600;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 24px; height: 24px; background: #3b82f6; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold;">${index + 1}</div>
          <div>
            <div style="font-size: 14px;">${title}</div>
            <div style="font-size: 11px; color: #6b7280;">${bomParts} BOM parts</div>
          </div>
        </div>
      </td>
      ${cells}
    </tr>
    ${section.subTasks.map((t, i) => subTaskRows(t, i, columns, showBom))}`;
}

export function buildGanttPrintHtml(input: GanttPrintInput): string {
  const columns = COLUMN_COUNT[input.viewMode];
  const headers = Array.from(
    { length: columns },
    (_, i) => html`<th style="border: 1px solid #e5e7eb; padding: 8px; font-size: 11px; text-align: center; background: #f9fafb;">${dateLabel(input.viewMode, input.now, i)}</th>`,
  );
  const rows = input.hasProcesses
    ? input.sections.map((s, i) => sectionRows(s, i, columns, input.showBom))
    : html`
      <tr>
        <td colspan="${columns + 1}" style="text-align: center; padding: 40px; color: #6b7280;">
          No processes found for this lot. Create processes to see them in the Gantt chart.
        </td>
      </tr>`;
  const mode = input.viewMode.charAt(0).toUpperCase() + input.viewMode.slice(1);
  return html`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Production Planning Gantt Chart - ${input.now.toLocaleDateString()}</title>
      ${STYLE}
    </head>
    <body>
      <div class="header">
        <h1>Production Planning Gantt Chart</h1>
        <p>Generated on ${input.now.toLocaleDateString()} at ${input.now.toLocaleTimeString()}</p>
        <p>View Mode: ${mode} | Total Tasks: ${input.totalTasks} | Completed: ${input.completedTasks}</p>
      </div>
      <table class="gantt-table">
        <thead>
          <tr>
            <th style="width: 300px;">Task</th>
            ${headers}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      ${LEGEND}
      <div class="footer">
        Production Planning System | Lot ID: ${input.lotId} | Export Date: ${input.now.toISOString()}
      </div>
      ${SCRIPT}
    </body>
    </html>`.value;
}

// Static markup: no values in it.
const LEGEND = new SafeHtml(`
      <div class="legend">
        <div style="font-weight: 600; margin-right: 20px;">BOM Status Colors:</div>
        <div class="legend-item"><div class="legend-color" style="background: #22c55e;"></div><span>Available</span></div>
        <div class="legend-item"><div class="legend-color" style="background: #eab308;"></div><span>Partial</span></div>
        <div class="legend-item"><div class="legend-color" style="background: #ef4444;"></div><span>Shortage</span></div>
        <div class="legend-item"><div class="legend-color" style="background: #6b7280;"></div><span>Pending</span></div>
        <div style="margin-left: 30px; font-style: italic;">Progress: hours completed | Status: IN_PROGRESS, PLANNED, COMPLETED</div>
      </div>`);

const STYLE = new SafeHtml(`
        <style>
          @page {
            size: A4 landscape;
            margin: 0.5in;
          }
          @media print {
            body { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; }
            * { -webkit-print-color-adjust: exact !important; color-adjust: exact !important; }
            .gantt-table th { background-color: #f9fafb !important; }
            .process-cell { background-color: #3b82f6 !important; color: white !important; }
            .subtask-cell { background-color: #fb923c !important; color: white !important; }
            .bom-available { background-color: #3b82f6 !important; color: white !important; }
            .bom-partial { background-color: #eab308 !important; color: white !important; }
            .bom-shortage { background-color: #ef4444 !important; color: white !important; }
            .bom-pending { background-color: #6b7280 !important; color: white !important; }
          }
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            font-size: 12px;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
            border-bottom: 3px solid #3b82f6;
            padding-bottom: 15px;
          }
          .header h1 {
            margin: 0;
            color: #1f2937;
            font-size: 24px;
            font-weight: bold;
          }
          .header p {
            margin: 5px 0;
            color: #6b7280;
            font-size: 14px;
          }
          .gantt-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
            border: 2px solid #374151;
          }
          .gantt-table th, .gantt-table td {
            border: 1px solid #374151 !important;
            text-align: left;
            vertical-align: middle;
          }
          .gantt-table th {
            background-color: #f9fafb !important;
            font-weight: 600;
            padding: 10px 8px;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .legend {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
            margin-top: 20px;
            padding: 15px;
            background: #f9fafb !important;
            border-radius: 8px;
            border: 2px solid #d1d5db;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .legend-color {
            width: 16px;
            height: 16px;
            border-radius: 4px;
            border: 1px solid #374151;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .footer {
            margin-top: 20px;
            text-align: center;
            color: #6b7280;
            font-size: 11px;
            border-top: 2px solid #e5e7eb;
            padding-top: 10px;
          }
          .process-cell {
            background-color: #3b82f6 !important;
            color: white !important;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .subtask-cell {
            background-color: #fb923c !important;
            color: white !important;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .bom-available {
            background-color: #3b82f6 !important;
            color: white !important;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .bom-partial {
            background-color: #eab308 !important;
            color: white !important;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .bom-shortage {
            background-color: #ef4444 !important;
            color: white !important;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .bom-pending {
            background-color: #6b7280 !important;
            color: white !important;
            -webkit-print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
        </style>`);

const SCRIPT = new SafeHtml(`
        <script>
          // Show instructions for color printing
          window.onload = function() {
            const instructions = document.createElement('div');
            instructions.innerHTML = \`
              <div style="position: fixed; top: 10px; right: 10px; background: #1f2937; color: white; padding: 15px; border-radius: 8px; font-size: 12px; z-index: 9999; max-width: 300px;">
                <strong>📋 Print Instructions:</strong><br>
                1. Press Ctrl+P (Cmd+P on Mac)<br>
                2. Choose "Save as PDF" or your printer<br>
                3. Click "More settings"<br>
                4. Enable "Background graphics" for colors<br>
                5. Set Layout to "Landscape"<br>
                <button onclick="this.parentElement.remove()" style="margin-top: 8px; background: #3b82f6; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">Got it!</button>
              </div>
            \`;
            document.body.appendChild(instructions);
          };
          
          // Auto-close window after printing
          window.onafterprint = function() {
            setTimeout(() => window.close(), 1000);
          };
        </script>`);
