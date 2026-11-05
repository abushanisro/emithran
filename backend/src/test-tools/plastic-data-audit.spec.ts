import { compareMaterialFiles, housekeeping, injectionGaps, parseCsv, pressFindings, unreadNames } from './plastic-data-audit';

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, and drops a BOM', () => {
    const rows = parseCsv('﻿name,note\r\n"A, B","say ""hi""\nthere"\r\nC,\r\n');
    expect(rows).toEqual([{ name: 'A, B', note: 'say "hi"\nthere' }, { name: 'C', note: '' }]);
  });
  it('is empty for an empty file', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('compareMaterialFiles', () => {
  const final = parseCsv('sourceName,cost.unitCostUsdPerKg,thermalProperties.meltingTempC\nGeneric PET Bottle,2.5,232\nGeneric PP,0.93,200\nOnly Here,1,1');
  const full = parseCsv('Source Name,Unit Cost (USD / kg),Melting Temp (C)\ngeneric  pet bottle,2.5,255\nGeneric PP,2.48,200\nOnly There,1,1');

  it('names each material and field that differs, matching names case- and space-insensitively', () => {
    const { differences } = compareMaterialFiles(final, full);
    expect(differences).toEqual([
      { material: 'Generic PET Bottle', field: 'melt temperature', a: 232, b: 255 },
      { material: 'Generic PP', field: 'price (USD/kg)', a: 0.93, b: 2.48 },
    ]);
  });
  it('lists the materials found in one file only', () => {
    const { onlyInFinal, onlyInFull } = compareMaterialFiles(final, full);
    expect(onlyInFinal).toEqual(['Only Here']);
    expect(onlyInFull).toEqual(['Only There']);
  });
  it('treats a value on one side only as a difference, and equal values within the tolerance as none', () => {
    const a = parseCsv('sourceName,cost.unitCostUsdPerKg\nM,2.000');
    expect(compareMaterialFiles(a, parseCsv('Source Name,Unit Cost (USD / kg)\nM,2.005')).differences).toEqual([]);
    expect(compareMaterialFiles(a, parseCsv('Source Name,Unit Cost (USD / kg)\nM,')).differences).toHaveLength(1);
  });
});

describe('injectionGaps', () => {
  const header = 'sourceName,processCompatibility.canIM_SFM,processingParameters.injectionPressureMaxMPa,processingParameters.flowLengthRatio,thermalProperties.meltingTempC,thermalProperties.moldTempC,physicalProperties.densityOfMeltKgM3';
  it('flags an injection-capable material by what it lacks, treating a zero temperature as missing', () => {
    const rows = parseCsv(`${header}\nGood,True,150,175,240,70,885\nNo data,True,,,0,0,\nThermoset,False,,,,,`);
    expect(injectionGaps(rows)).toEqual([{ material: 'No data', missing: ['injection pressure', 'flow length ratio', 'melt temperature', 'mold temperature', 'melt density'] }]);
  });
});

describe('pressFindings', () => {
  const rows = parseCsv([
    'name,limits.clampingForceKn,machine.machinePriceUsd,rates.plasticizingRateGppsGPerS,time.dryCycleTimeS',
    'A,1000,200000,5,2', 'B,2000,410000,,2', 'C,1500,310000,6,2', 'D,980,903000,5,', 'E,1200,250000,4,2',
  ].join('\n'));
  it('flags a press whose price per kN is far from the median, and counts blanks', () => {
    const { findings, blanks, presses } = pressFindings(rows);
    expect(findings.map((f) => f.press)).toEqual(['D']);
    expect(presses).toBe(5);
    expect(blanks['rates.plasticizingRateGppsGPerS']).toBe(1);
    expect(blanks['time.dryCycleTimeS']).toBe(1);
  });
});

describe('unreadNames', () => {
  it('finds the names that appear nowhere as a whole word', () => {
    const code = "read('tblToolLife'); const x = defaultToolLife; // SPIFinishesExtra";
    expect(unreadNames(['tblToolLife', 'defaultToolLife', 'SPIFinishes', 'tblToolLifeX'], code)).toEqual(['SPIFinishes', 'tblToolLifeX']);
  });
});

describe('housekeeping', () => {
  it('finds download copies beside their original, stray numbered files, and files of another domain', () => {
    const out = housekeeping(['a.csv', 'a (1).csv', 'b (2).csv', 'machine/India/machine_rates.csv', 'machine/India/raw_material_stock_costs.csv']);
    expect(out.copies).toEqual(['a (1).csv']);
    expect(out.strayCopies).toEqual(['b (2).csv']);
    expect(out.notPlastics).toEqual(['machine/India/machine_rates.csv', 'machine/India/raw_material_stock_costs.csv']);
  });
});
