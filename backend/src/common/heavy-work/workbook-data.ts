import * as ExcelJS from 'exceljs';

// A workbook's cell values as plain data, so a workbook parsed in a worker thread can be handed back to the API (an ExcelJS object
// cannot cross a thread). Imports read values only, never styles, so this is what they see: every sheet in order with its
// visibility, every row that exists (with or without values, so rowCount and includeEmpty iteration are unchanged), and every
// cell's value as ExcelJS reports it (numbers, strings, dates, rich text, formulas with their results, hyperlinks, errors).

export interface RowData {
  number: number;
  /** Cells the row has, valued or not (row.cellCount). */
  cellCount: number;
  /** Sparse, indexed by column number, as row.values. */
  values: ExcelJS.CellValue[];
}

export interface SheetData {
  name: string;
  state: ExcelJS.WorksheetState;
  rows: RowData[];
}

export function workbookToData(workbook: ExcelJS.Workbook): SheetData[] {
  return workbook.worksheets.map((sheet) => {
    const rows: RowData[] = [];
    for (let number = 1; number <= sheet.rowCount; number++) {
      const row = sheet.findRow(number); // the rows the file holds; getRow would create the missing ones
      if (row) rows.push({ number, cellCount: row.cellCount, values: row.values as ExcelJS.CellValue[] });
    }
    return { name: sheet.name, state: sheet.state, rows };
  });
}

export function workbookFromData(sheets: SheetData[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  for (const data of sheets) {
    const sheet = workbook.addWorksheet(data.name, { state: data.state });
    for (const { number, cellCount, values } of data.rows) {
      const row = sheet.getRow(number);
      // Cell by cell rather than `row.values = values`, whose `instanceof Array` test fails for an array from another realm.
      values.forEach((value, column) => {
        if (value !== undefined && value !== null) row.getCell(column).value = value;
      });
      if (cellCount > 0) row.getCell(cellCount); // creates the trailing empty cells the file had
    }
  }
  return workbook;
}
