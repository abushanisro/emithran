// Material price for the stock form a machined blank is cut from, at the quote
// location: material_stock_prices (migration 833; memory/Plastic Modeling/
// machine/India/raw_material_stock_costs.csv). Pure; the caller loads the rows.
//
// The priced form is the stock the machining engine costs the material on:
//   milled            -> plate      (billet: bounding box + reference allowance,
//                                    cut from plate, the milled family's first
//                                    preferred shape, material-shape-ranking.ts)
//   turned, mill_turn -> round_bar  (bar stock, computeTurningCostSummary)
// No price for that material, form and location = no stock price: the quote
// keeps its raw_materials price and says a form price is not on file.

import { isTurnedFamily } from '../../../../domain/part-family';

type StockPriceForm = 'round_bar' | 'hex_bar' | 'rectangular_bar' | 'square_bar' | 'round_tube' | 'plate';

export interface StockPriceRow {
  raw_material_name: string | null;
  stock_form: string;
  location: string;
  price_per_kg: number | string;
  currency_code: string;
  source: string;
}

// A Stock Form chosen in the scenario is priced as that form (a billet is sawn from plate); with no choice the
// family's own stock applies.
export function machiningStockPriceForm(family: string, chosenForm?: string | null): StockPriceForm | null {
  if (chosenForm && (family === 'milled' || isTurnedFamily(family))) {
    // A billet is sawn from plate. A round tube cannot be sized yet (no bore from CAD), so the blank falls back
    // to a billet (blank-stock-candidates.ts) and is priced as one.
    return chosenForm === 'billet' || chosenForm === 'round_tube' ? 'plate' : (chosenForm as StockPriceForm);
  }
  if (family === 'milled') return 'plate';
  if (isTurnedFamily(family)) return 'round_bar';
  return null;
}

interface StockPrice {
  form: StockPriceForm;
  pricePerKg: number;
  currencyCode: string;
  source: string;
}

export function resolveStockPrice(
  rows: readonly StockPriceRow[],
  materialName: string | null | undefined,
  family: string,
  location: string,
  chosenForm?: string | null,
): StockPrice | null {
  const form = machiningStockPriceForm(family, chosenForm);
  if (!form || !materialName) return null;
  const row = rows.find((r) =>
    r.raw_material_name != null && r.raw_material_name.toLowerCase() === materialName.toLowerCase()
    && r.stock_form === form && r.location === location);
  const price = row ? Number(row.price_per_kg) : NaN;
  if (!row || !(price > 0)) return null;
  return { form, pricePerKg: price, currencyCode: row.currency_code, source: row.source };
}
