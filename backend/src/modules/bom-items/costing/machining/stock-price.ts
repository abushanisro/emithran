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

export type StockPriceForm = 'round_bar' | 'hex_bar' | 'rectangular_bar' | 'square_bar' | 'round_tube' | 'plate';

export interface StockPriceRow {
  raw_material_name: string | null;
  stock_form: string;
  location: string;
  price_per_kg: number | string;
  currency_code: string;
  source: string;
}

export function machiningStockPriceForm(family: string): StockPriceForm | null {
  if (family === 'milled') return 'plate';
  if (family === 'turned' || family === 'mill_turn') return 'round_bar';
  return null;
}

export interface StockPrice {
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
): StockPrice | null {
  const form = machiningStockPriceForm(family);
  if (!form || !materialName) return null;
  const row = rows.find((r) =>
    r.raw_material_name != null && r.raw_material_name.toLowerCase() === materialName.toLowerCase()
    && r.stock_form === form && r.location === location);
  const price = row ? Number(row.price_per_kg) : NaN;
  if (!row || !(price > 0)) return null;
  return { form, pricePerKg: price, currencyCode: row.currency_code, source: row.source };
}
