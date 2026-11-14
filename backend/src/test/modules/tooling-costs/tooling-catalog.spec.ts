import {
  TOOLING_CATALOGS,
  catalogItems,
  catalogDomains,
  catalogSourceProblem,
  parseCatalogNumber,
} from '../../../modules/tooling-costs/catalog/tooling-catalog';
import { MEMORY_DOMAINS } from '../../../modules/processes/reference-domains';

// Rows copied from the staged reference data (machining_reference_data), one or two per table.
const PLASTIC_COMPONENT = { name: 'Air Poppet', notes: null, quantity: 30, file_path: 'lookupTables/Component/cmStandardToolingComponents.csv', unit_cost_usd: 25 };
const TOOL_STEEL = { name: 'AISI 1020', hardness: 143, densityKgPerM3: 7850, materialCostUsdPerKg: 1.54 };
const TRANSFER_DIE = { Name: 'aerialCamUnit', Model: '1000Series', 'Size (mm)': '1,000.00', 'Cost (USD)': '16,080.00', 'Weight (kg)': 543 };
const COREBOX = { Type: 'Mahogany', 'One Cavity Cost (USD)': 920, 'Corebox Cost Intercept (USD)': 920 };

describe('tooling catalog', () => {
  it('parses staged numbers, including thousands separators, and never guesses a blank or text cell', () => {
    expect(parseCatalogNumber('16,080.00')).toBe(16080);
    expect(parseCatalogNumber(25)).toBe(25);
    expect(parseCatalogNumber(' 1,700 ')).toBe(1700);
    expect(parseCatalogNumber(null)).toBeNull();
    expect(parseCatalogNumber('')).toBeNull();
    expect(parseCatalogNumber('n/a')).toBeNull();
  });

  it('reads a plastic mold component as an item priced each, with its typical quantity per mold and its source row', () => {
    const def = TOOLING_CATALOGS.injection_molding[0];
    const { items, unpriced } = catalogItems(def, '2026-Plastic', [PLASTIC_COMPONENT]);
    expect(unpriced).toEqual([]);
    expect(items).toEqual([{
      id: '2026-Plastic:cmStandardToolingComponents:0',
      kind: 'Mold component',
      name: 'Air Poppet',
      details: '',
      unitCostUsd: 25,
      unit: 'each',
      typicalQuantity: 30,
      source: { dataset: '2026-Plastic', table: 'cmStandardToolingComponents', row: 0 },
    }]);
  });

  it('prices a tool steel per kg', () => {
    const def = TOOLING_CATALOGS.injection_molding.find((d) => d.table === 'digital_factory_tool_materials_usa')!;
    const [item] = catalogItems(def, '2026-Plastic', [TOOL_STEEL]).items;
    expect(item).toMatchObject({ kind: 'Tool steel', name: 'AISI 1020', unitCostUsd: 1.54, unit: 'kg', details: 'hardness 143' });
  });

  it('reads comma-formatted transfer die costs and describes the item by its model and size', () => {
    const def = TOOLING_CATALOGS.sheet_transfer_die[0];
    const [item] = catalogItems(def, '2026-TransferDie', [TRANSFER_DIE]).items;
    expect(item).toMatchObject({ kind: 'Die component', name: 'aerialCamUnit', unitCostUsd: 16080, unit: 'each', details: 'Model 1000Series, Size (mm) 1,000.00, Weight (kg) 543' });
  });

  it('prices a corebox per cavity', () => {
    const def = TOOLING_CATALOGS.sand_casting[0];
    const [item] = catalogItems(def, '2026-SandCasting', [COREBOX]).items;
    expect(item).toMatchObject({ kind: 'Corebox', name: 'Mahogany', unitCostUsd: 920, unit: 'cavity' });
  });

  it('lists a row with no price as unpriced instead of costing it at zero', () => {
    const def = TOOLING_CATALOGS.sheet_transfer_die[0];
    const r = catalogItems(def, '2026-TransferDie', [{ ...TRANSFER_DIE, 'Cost (USD)': null }, { Name: null, 'Cost (USD)': 5 }]);
    expect(r.items).toEqual([]);
    expect(r.unpriced).toEqual(['aerialCamUnit', '(row 1: no name)']);
  });

  it('covers only domains staged from memory/ (plus machining and sheet metal), each table named once', () => {
    const memoryKeys = new Set(MEMORY_DOMAINS.map((d) => d.key));
    for (const domain of Object.keys(TOOLING_CATALOGS)) {
      expect(memoryKeys.has(domain) || domain === 'machining' || domain === 'sheet_metal').toBe(true);
      const tables = TOOLING_CATALOGS[domain].map((d) => d.table);
      expect(new Set(tables).size).toBe(tables.length);
    }
    expect(catalogDomains()).toEqual(expect.arrayContaining([
      { key: 'injection_molding', label: 'Plastic Molding' },
      { key: 'sheet_metal', label: 'Sheet Metal' },
      { key: 'machining', label: 'Machining' },
    ]));
  });

  describe('a saved row\'s catalog source', () => {
    const catalog = { label: 'Plastic Molding', items: [{ id: '2026-Plastic:cmStandardToolingComponents:0' }] };

    it('is fine when absent, or when it names an item of the row\'s process catalog', () => {
      expect(catalogSourceProblem({ process: null, source: null, isCustom: true }, null)).toBeNull();
      expect(catalogSourceProblem({ process: 'injection_molding', source: '2026-Plastic:cmStandardToolingComponents:0', isCustom: false }, catalog)).toBeNull();
    });

    it('is refused on a custom item, without a process, or when the catalog has no such item', () => {
      expect(catalogSourceProblem({ process: 'injection_molding', source: '2026-Plastic:cmStandardToolingComponents:0', isCustom: true }, catalog))
        .toBe('A custom item has no catalog source');
      expect(catalogSourceProblem({ process: null, source: '2026-Plastic:cmStandardToolingComponents:0', isCustom: false }, null))
        .toBe('A catalog item needs its manufacturing process');
      expect(catalogSourceProblem({ process: 'injection_molding', source: '2026-Plastic:cmStandardToolingComponents:99', isCustom: false }, catalog))
        .toBe('2026-Plastic:cmStandardToolingComponents:99 is not an item of the Plastic Molding tooling catalog');
    });
  });
});
