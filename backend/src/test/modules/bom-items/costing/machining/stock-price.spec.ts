/**
 * stock-price.ts: a machined part's material price comes from the stock form
 * the engine costs it on, at the quote location, from the real
 * memory/Plastic Modeling/machine/India/raw_material_stock_costs.csv rows
 * (what migration 833 stages; raw_material_name as its "Generic " link gives).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { machiningStockPriceForm, resolveStockPrice, type StockPriceRow } from '../../../../../modules/bom-items/costing/machining/stock-price';

const CSV = join(__dirname, '../../../../../../../memory/Plastic Modeling/machine/India/raw_material_stock_costs.csv');
const FORMS: Record<string, string> = {
  Hex_Bar_USD_per_kg: 'hex_bar', Plate_USD_per_kg: 'plate', Rectangular_Bar_USD_per_kg: 'rectangular_bar',
  Round_Bar_USD_per_kg: 'round_bar', Round_Tube_USD_per_kg: 'round_tube', Square_Bar_USD_per_kg: 'square_bar',
};

function rows(): StockPriceRow[] {
  const lines = readFileSync(CSV, 'utf-8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  const header = lines[0]!.split(',');
  const out: StockPriceRow[] = [];
  for (const line of lines.slice(1)) {
    // "Material" is quoted (it contains commas); the price columns are plain numbers.
    const m = /^"([^"]*)",(.*)$/.exec(line) ?? /^([^,]*),(.*)$/.exec(line)!;
    const prices = m[2]!.split(',');
    header.slice(1).forEach((col, i) => {
      if (prices[i]) out.push({ raw_material_name: `Generic ${m[1]}`, stock_form: FORMS[col]!, location: 'India', price_per_kg: prices[i]!, currency_code: 'USD', source: 'csv' });
    });
  }
  return out;
}
const ROWS = rows();

describe('stock-price', () => {
  it('prices milled parts on plate and turned / mill-turn parts on round bar', () => {
    expect(machiningStockPriceForm('milled')).toBe('plate');
    expect(machiningStockPriceForm('turned')).toBe('round_bar');
    expect(machiningStockPriceForm('mill_turn')).toBe('round_bar');
    expect(machiningStockPriceForm('sheet_metal')).toBeNull();
  });

  it('reads the real India prices: AISI 1006 plate 0.938, round bar 0.741 USD/kg', () => {
    expect(resolveStockPrice(ROWS, 'Generic Steel, Hot Worked, AISI 1006', 'milled', 'India'))
      .toMatchObject({ form: 'plate', pricePerKg: 0.938, currencyCode: 'USD' });
    expect(resolveStockPrice(ROWS, 'generic steel, hot worked, aisi 1006', 'turned', 'India'))
      .toMatchObject({ form: 'round_bar', pricePerKg: 0.741 });
  });

  it('has no stock price for another location or an unlisted material', () => {
    expect(resolveStockPrice(ROWS, 'Generic Steel, Hot Worked, AISI 1006', 'milled', 'USA')).toBeNull();
    expect(resolveStockPrice(ROWS, 'Generic Unobtainium', 'milled', 'India')).toBeNull();
  });
});
