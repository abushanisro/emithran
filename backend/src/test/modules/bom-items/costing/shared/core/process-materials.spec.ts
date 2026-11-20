import {
  closestProcessMaterial, isMaterialNamed, pricedGradeFor, PROCESS_OWN_MATERIAL_GROUP, type OwnMaterial, type ProcessMaterial,
} from '../../../../../../modules/bom-items/costing/shared/core/process-materials';

// Rows as raw_materials holds them for the Bar and Tube Fabrication group (names, types and densities from the local data).
const BAR_TUBE: ProcessMaterial[] = [
  { name: 'Steel, Cold Drawn, AISI 1018', grade: 'Generic Steel, Cold Drawn, AISI 1018', materialType: 'Steel', densityKgM3: 7870 },
  { name: 'Aluminum, ANSI 6061', grade: 'Generic Aluminum, ANSI 6061', materialType: 'Aluminum', densityKgM3: 2700 },
  { name: 'Aluminum, ANSI 1100', grade: 'Generic Aluminum, ANSI 1100', materialType: 'Aluminum', densityKgM3: 2710 },
  { name: 'Titanium, Grade 2', grade: 'Generic Titanium, Grade 2', materialType: 'Titanium', densityKgM3: 4510 },
];
const petg: OwnMaterial = { name: 'Generic PETG Copol', grade: 'Generic PETG Copol', materialGroup: 'Plastic & Rubber', materialType: 'PET', densityKgM3: 1200 };

describe('the grade a process prices (Apply never fails on a material the process cannot use)', () => {
  it('a grade of the process is priced as given, by name or by grade, case-insensitively', () => {
    expect(isMaterialNamed(BAR_TUBE[1], 'aluminum, ansi 6061')).toBe(true);
    expect(isMaterialNamed(BAR_TUBE[1], 'Generic Aluminum, ANSI 6061')).toBe(true);
    expect(pricedGradeFor({ family: 'bar_tube', processLabel: 'Bar and Tube Fabrication', grade: 'Generic Aluminum, ANSI 6061', own: null, materials: BAR_TUBE }))
      .toEqual({ grade: 'Generic Aluminum, ANSI 6061', note: null });
  });

  it('a grade of another process is priced as the closest own material: no shared type, so the nearest density, said in a note', () => {
    const r = pricedGradeFor({ family: 'bar_tube', processLabel: 'Bar and Tube Fabrication', grade: 'Generic PETG Copol', own: petg, materials: BAR_TUBE });
    expect(r.grade).toBe('Aluminum, ANSI 6061');
    expect(r.note).toBe('"Generic PETG Copol" is not a Bar and Tube Fabrication material: priced as "Aluminum, ANSI 6061", its closest Bar and Tube Fabrication '
      + 'material (nearest density). Choose a Bar and Tube Fabrication material in Material Grade to price another.');
  });

  it('closeness: the same grade first, then the same material type, then the nearest density, then the name', () => {
    const steelSheet: OwnMaterial = { name: 'Steel, Cold Worked, AISI 1020', grade: null, materialGroup: 'Ferrous & Non-Ferrous', materialType: 'Steel', densityKgM3: 2000 };
    expect(closestProcessMaterial(steelSheet, BAR_TUBE)).toEqual({ material: BAR_TUBE[0], by: 'material type' });
    const sameName: OwnMaterial = { ...steelSheet, name: 'Titanium, Grade 2', materialType: 'Steel' };
    expect(closestProcessMaterial(sameName, BAR_TUBE)).toEqual({ material: BAR_TUBE[3], by: 'grade' });
    // A grade the search cannot place has no type or density: the first material by name, so it is still priced.
    expect(closestProcessMaterial(null, BAR_TUBE)).toEqual({ material: BAR_TUBE[2], by: 'name' });
    expect(closestProcessMaterial(petg, [])).toBeNull();
  });

  it('an exact-name engine gets the row name of a grade the search placed in its group; a ranked-search engine (molding) gets the grade as given', () => {
    const placed: OwnMaterial = { name: 'Aluminum, ANSI 6061', grade: 'Generic Aluminum, ANSI 6061', materialGroup: 'Bar and Tube Fabrication', materialType: 'Aluminum', densityKgM3: 2700 };
    expect(pricedGradeFor({ family: 'bar_tube', processLabel: 'Bar and Tube Fabrication', grade: '6061', own: placed, materials: BAR_TUBE }))
      .toEqual({ grade: 'Aluminum, ANSI 6061', note: null });
    const abs: OwnMaterial = { name: 'Generic ABS', grade: 'Generic ABS', materialGroup: 'Plastic & Rubber', materialType: 'ABS', densityKgM3: 1050 };
    expect(pricedGradeFor({ family: 'plastic_molded', processLabel: 'Plastic Molding', grade: 'ABS', own: abs, materials: [] })).toEqual({ grade: 'ABS', note: null });
  });

  it('a process that prices any grade (machining, sheet metal) is not narrowed: a PETG part is machined as PETG', () => {
    for (const family of ['milled', 'turned', 'mill_turn', 'sheet_metal']) {
      expect(PROCESS_OWN_MATERIAL_GROUP[family]).toBeUndefined();
      expect(pricedGradeFor({ family, processLabel: 'Machining', grade: 'Generic PETG Copol', own: petg, materials: BAR_TUBE })).toEqual({ grade: 'Generic PETG Copol', note: null });
    }
  });

  it('every engine that matches its grade by exact name in its own group is covered', () => {
    expect(PROCESS_OWN_MATERIAL_GROUP).toEqual({
      die_cast: 'Die Casting', sand_cast: 'Sand Casting', investment_cast: 'Casting Investment', forged: 'Forging', powder_metal: 'Powder Metal',
      composite: 'Composites', additive: 'Additive Manufacturing', bar_tube: 'Bar and Tube Fabrication', plastic_molded: 'Plastic & Rubber',
    });
  });
});
