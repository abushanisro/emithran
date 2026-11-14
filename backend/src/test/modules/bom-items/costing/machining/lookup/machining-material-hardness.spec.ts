import {
  MACHINING_MATERIAL,
  nearestByHardness,
  nearestByDiameterThenHardness,
  nearestByDiameterKey,
} from '../../../../../../modules/bom-items/costing/machining/lookup/machining-material-hardness';

// Root-caused 2026-09-16: tblCounterboring/tblReaming/tblChamfering/
// tblDeburring key their real rows by a numeric material_cut_code with no
// name legend anywhere in the reference data (verified, not assumed —
// searched every memory/machining/ file and every migration). This bridges
// through real hardness instead of fabricating a code->name mapping.
describe('MACHINING_MATERIAL — every MaterialClass has a real or disclosed-fallback value', () => {
  it('covers all 7 MaterialClass values', () => {
    const classes: Array<keyof typeof MACHINING_MATERIAL> = [
      'aluminum', 'mild_steel', 'stainless', 'titanium', 'copper_alloy', 'tool_steel', 'plastic',
    ];
    for (const c of classes) {
      expect(typeof MACHINING_MATERIAL[c].hb).toBe('number');
    }
  });

  it('orders real classes by real relative hardness (aluminum softest, stainless hardest of the real 4)', () => {
    expect(MACHINING_MATERIAL.aluminum.hb).toBeLessThan(MACHINING_MATERIAL.copper_alloy.hb);
    expect(MACHINING_MATERIAL.copper_alloy.hb).toBeLessThan(MACHINING_MATERIAL.mild_steel.hb);
    expect(MACHINING_MATERIAL.mild_steel.hb).toBeLessThan(MACHINING_MATERIAL.stainless.hb);
  });

  it('titanium, tool steel and plastic carry no hardness (no reference data) rather than a stand-in', () => {
    expect(MACHINING_MATERIAL.titanium.hb).toBeNaN();
    expect(MACHINING_MATERIAL.tool_steel.hb).toBeNaN();
    expect(MACHINING_MATERIAL.plastic.hb).toBeNaN();
  });

  it('so every matcher reports them missing instead of borrowing the hardest/softest row', () => {
    const rows = [{ hardness: 30, diameter_mm: 6 }, { hardness: 1050, diameter_mm: 6 }];
    expect(nearestByHardness(rows, MACHINING_MATERIAL.titanium)).toBeNull();
    expect(nearestByDiameterThenHardness(rows, 6, MACHINING_MATERIAL.plastic)).toBeNull();
  });
});

describe('nearestByHardness', () => {
  const rows = [
    { hardness: 125, id: 'soft' },
    { hardness: 275, id: 'mid' },
    { Hardness: 500, id: 'hard-capitalized-field' }, // tblReaming uses CamelCase; must handle both
  ];

  it('picks the row with the real nearest hardness', () => {
    expect(nearestByHardness(rows, 130)?.id).toBe('soft');
    expect(nearestByHardness(rows, 260)?.id).toBe('mid');
  });

  it('handles the CamelCase Hardness field (tblReaming shape), not just snake_case', () => {
    expect(nearestByHardness(rows, 480)?.id).toBe('hard-capitalized-field');
  });

  it('skips rows with no real hardness field rather than treating them as a match', () => {
    const withGap = [{ id: 'no-hardness', foo: 1 }, { hardness: 150, id: 'real-low' }, { hardness: 200, id: 'real' }];
    expect(nearestByHardness(withGap, 190)?.id).toBe('real');
  });

  it('never extrapolates past the table: a hardness outside its range is missing', () => {
    expect(nearestByHardness(rows, 100)).toBeNull(); // below 125
    expect(nearestByHardness(rows, 999)).toBeNull(); // above 500
  });

  it('returns null when no row has any real hardness data', () => {
    expect(nearestByHardness([{ foo: 1 }], 100)).toBeNull();
  });
});

describe('nearestByDiameterThenHardness', () => {
  const rows = [
    { diameter_mm: 6, hardness: 125, id: 'd6-soft' },
    { diameter_mm: 6, hardness: 275, id: 'd6-hard' },
    { diameter_mm: 10, hardness: 125, id: 'd10-soft' },
    { DiameterMm: 10, Hardness: 500, id: 'd10-hard-camelcase' }, // tblReaming shape
  ];

  it('matches the real nearest diameter first, then real nearest hardness among that diameter', () => {
    expect(nearestByDiameterThenHardness(rows, 6, 130)?.id).toBe('d6-soft');
    expect(nearestByDiameterThenHardness(rows, 6, 260)?.id).toBe('d6-hard');
  });

  it('handles the CamelCase DiameterMm/Hardness fields (tblReaming), not just snake_case', () => {
    expect(nearestByDiameterThenHardness(rows, 10, 480)?.id).toBe('d10-hard-camelcase');
  });

  it('never extrapolates past the table: a diameter outside its range is missing', () => {
    expect(nearestByDiameterThenHardness(rows, 4, 130)).toBeNull();  // below 6
    expect(nearestByDiameterThenHardness(rows, 12, 130)).toBeNull(); // above 10
  });

  it('picks the real nearest diameter even when not exact', () => {
    // 8mm requested, real diameters on file are 6 and 10 -> 6 is nearer
    expect(nearestByDiameterThenHardness(rows, 8, 130)?.id).toBe('d6-soft');
  });

  it('returns null when no row has real diameter data', () => {
    expect(nearestByDiameterThenHardness([{ hardness: 100 }], 6, 100)).toBeNull();
  });

  // tblGunDrilling.json's real column names, transcribed verbatim from its
  // source spreadsheet — a third real spelling alongside snake_case/CamelCase.
  it("handles tblGunDrilling's 'Diameter (mm)'/'Hardness' real column names", () => {
    const gunDrillRows = [
      { 'Diameter (mm)': 3, Hardness: 125, id: 'd3' },
      { 'Diameter (mm)': 9, Hardness: 125, id: 'd9' },
    ];
    expect(nearestByDiameterThenHardness(gunDrillRows, 4, 125)?.id).toBe('d3');
  });
});

// deep_bore_drill_lookup.json/deep_bore_trepan_lookup.json (and
// straight_drill_lookup.json's tblDrilling) key feed/depth by diameter as a
// nested {"<diameterMm>": value} map inside each material row, rather than
// one row per (material, diameter) — genuinely different real shape.
describe('nearestByDiameterKey', () => {
  const byDiameter = { '12.0': 0.04, '18.0': 0.06, '32.0': 0.093, '50.0': 0.107 };

  it('picks the value at the real nearest diameter key', () => {
    expect(nearestByDiameterKey(byDiameter, 12)).toBe(0.04);
    expect(nearestByDiameterKey(byDiameter, 20)).toBe(0.06); // 18 nearer than 32
  });

  it('returns null for an absent or empty map rather than guessing', () => {
    expect(nearestByDiameterKey(undefined, 12)).toBeNull();
    expect(nearestByDiameterKey(null, 12)).toBeNull();
    expect(nearestByDiameterKey({}, 12)).toBeNull();
  });

  it('ignores non-numeric keys rather than throwing', () => {
    expect(nearestByDiameterKey({ foo: 1, '12.0': 0.04 } as any, 12)).toBe(0.04);
  });
});

describe('rows are matched inside the material\'s own cut-code family', () => {
  const rows = [
    { MaterialCutCodeName: '5.21', Hardness: 200 }, { MaterialCutCodeName: '5.12', Hardness: 330 },
    { MaterialCutCodeName: '20.23', Hardness: 275 },
    { MaterialCutCodeName: '30.12', Hardness: 100 }, { MaterialCutCodeName: '33.3', Hardness: 100 },
  ];
  it('stainless at HB275 takes a stainless row, not the Hastelloy row of the same hardness', () => {
    expect(nearestByHardness(rows, MACHINING_MATERIAL.stainless)?.MaterialCutCodeName).toBe('5.12');
  });
  it('copper at HB100 takes the copper row, not the aluminum row listed before it', () => {
    expect(nearestByHardness(rows, MACHINING_MATERIAL.copper_alloy)?.MaterialCutCodeName).toBe('33.3');
  });
  it('a material whose family the table does not hold is missing', () => {
    expect(nearestByHardness(rows, MACHINING_MATERIAL.mild_steel)).toBeNull();
  });
});
