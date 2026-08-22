// Thin browser-side Excel helpers built on `exceljs` (also used server-side by
// the backend's importer). Replaces `xlsx`/SheetJS, whose published npm
// package has two long-standing advisories (prototype pollution, ReDoS) with
// no fix ever published to the npm registry — see GHSA-4r6h-8v6p-xvw6 and
// GHSA-5pgg-2g8v-p4x9. exceljs is actively maintained and has no open
// advisories at time of writing.
//
// These helpers cover exactly the operations this app's own xlsx call sites
// used (aoa-to-sheet, json-to-sheet, file download, file read, sheet-to-aoa)
// — not a general-purpose spreadsheet API.
import ExcelJS from 'exceljs';

export function createWorkbook(): ExcelJS.Workbook {
  return new ExcelJS.Workbook();
}

/** Mirrors XLSX.utils.aoa_to_sheet + book_append_sheet: one sheet from a 2D array, first row treated as the header row for width purposes only (no styling implied). */
export function addAoaSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  rows: readonly (readonly unknown[])[],
  columnWidths?: readonly number[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(sheetName);
  for (const row of rows) sheet.addRow([...row]);
  if (columnWidths) {
    columnWidths.forEach((width, i) => {
      const col = sheet.getColumn(i + 1);
      col.width = width;
    });
  }
  return sheet;
}

/** Mirrors XLSX.utils.json_to_sheet + book_append_sheet: header row from the ordered union of keys across all rows (first-seen order), then one data row per object. */
export function addJsonSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  rows: readonly Record<string, unknown>[],
): ExcelJS.Worksheet {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) { seen.add(key); headers.push(key); }
    }
  }
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map((h) => row[h] ?? null));
  return sheet;
}

/** Generates the workbook and triggers a browser download — the exceljs equivalent of XLSX.writeFile, which has no built-in browser download helper of its own. */
export async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads an uploaded .xlsx File into a workbook — replaces FileReader.readAsBinaryString + XLSX.read. */
export async function readWorkbookFile(file: File): Promise<ExcelJS.Workbook> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

/** Mirrors XLSX.utils.sheet_to_json(ws, { header: 1 }): one array per row, 1:1 with cell position (index 0 = column A), preserving blank leading cells. */
export function worksheetToAoa(worksheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as unknown[]; // exceljs is 1-indexed; index 0 is always empty
    rows.push(values.slice(1));
  });
  return rows;
}
