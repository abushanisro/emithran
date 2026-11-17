import { appliedCastingFamily } from '../../../../modules/bom-items/costing/shared/core/part-family-process-group';
import { MaterialResolutionService } from '../../../../modules/bom-items/services/material-resolution.service';
import type { BOMItemResponseDto } from '../../../../modules/bom-items/dto/bom-item-response.dto';

// Which process a part is costed as. The Back cover defect: Process set to Die Casting, a plastic left as its material,
// and the cost came back as an injection moulding route under a "Die Casting" heading.
const service = new MaterialResolutionService(null as never);
const resolve = (item: Partial<BOMItemResponseDto>, grade: string | null, geometryFamily?: string) =>
  service.resolveEffectiveFamily({
    item: { ...item, familyClassification: geometryFamily ?? item.familyClassification } as BOMItemResponseDto,
    fg: null, grade, sheetThicknessMm: 0,
  });

describe('the process a part is costed as', () => {
  it('is the Process the engineer chose, whatever the material', () => {
    const r = resolve({ scenarioOverrides: { processGroup: 'Die Casting' } }, 'Generic ABS, Fittings', 'die_cast');
    expect(r).toEqual({ family: 'die_cast', familySource: 'process', warning: null });
  });

  it('is the chosen Process even before the part is re-analysed as it', () => {
    expect(resolve({ scenarioOverrides: { processGroup: 'Casting Investment' } }, 'Aluminium 6061', 'milled').family).toBe('investment_cast');
  });

  it('keeps the geometry family among the families of the chosen Process (Machining: milled / turned)', () => {
    expect(resolve({ scenarioOverrides: { processGroup: 'Machining' } }, 'Aluminium 6061', 'turned').family).toBe('turned');
    expect(resolve({ scenarioOverrides: { processGroup: 'Machining' } }, 'Nylon, Type 66', 'sheet_metal').family).toBe('milled');
  });

  it('is the family override before the chosen Process', () => {
    const r = resolve({ manufacturingFamilyOverride: 'milled', scenarioOverrides: { processGroup: 'Die Casting' } }, 'ABS', 'die_cast');
    expect(r.familySource).toBe('override');
    expect(r.family).toBe('milled');
  });

  it('follows the material, then the geometry, when no Process with a cost model is chosen', () => {
    const plastic = resolve({}, 'Generic ABS, Fittings', 'die_cast');
    expect(plastic.family).toBe('plastic_molded');
    expect(plastic.familySource).toBe('material');
    expect(plastic.warning).toContain('thermoplastic');
    expect(resolve({}, 'Aluminium 6061', 'milled')).toEqual({ family: 'milled', familySource: 'geometry', warning: null });
  });

  it('is not costed when the chosen Process has no cost model, and names the processes that have one', () => {
    const r = resolve({ scenarioOverrides: { processGroup: 'Additive Manufacturing' } }, 'Generic ABS, Fittings', 'milled');
    expect(r.family).toBe('unknown');
    expect(r.familySource).toBe('process');
    expect(r.warning).toBe('The Process "Additive Manufacturing" has no cost model yet, so this part is not costed. Set its Process to one that has: Casting, Casting Investment, Composites, Die Casting, Forging, Machining, Plastic Molding, Powder Metal, Sand Casting, Sheet Metal, Sheet Metal - Hydroforming.');
  });

  it('a Powder Metal part is a powder metal part, whatever its material or last analysis', () => {
    expect(resolve({ scenarioOverrides: { processGroup: 'Powder Metal' } }, 'F-0005', 'milled')).toEqual({ family: 'powder_metal', familySource: 'process', warning: null });
  });

  it('a Composites part is a composite laminate, whatever its material or last analysis', () => {
    expect(resolve({ scenarioOverrides: { processGroup: 'Composites' } }, 'Generic Ply Material', 'milled')).toEqual({ family: 'composite', familySource: 'process', warning: null });
  });

  it('a Forging part is a forged part, whatever its material or last analysis', () => {
    expect(resolve({ scenarioOverrides: { processGroup: 'Forging' } }, 'Steel, AISI 4140, Medium-Carbon', 'die_cast')).toEqual({ family: 'forged', familySource: 'process', warning: null });
  });

  // The Back cover part again: Process set to Casting (the generic casting process). It is analysed as a die casting, the casting family whose
  // feature catalog is the widest, and priced by every casting process (casting-process-choice.ts).
  it('a Casting part is a casting family: the one it was analysed as, else die casting', () => {
    const casting = { scenarioOverrides: { processGroup: 'Casting' } };
    expect(resolve(casting, 'ASTM A148 Grade 80-40', 'milled')).toEqual({ family: 'die_cast', familySource: 'process', warning: null });
    expect(resolve(casting, 'ASTM A148 Grade 80-40', 'sand_cast').family).toBe('sand_cast');
  });

  it('a process priced as a route of another group is costed as that group (hydroforming: sheet metal)', () => {
    expect(resolve({ scenarioOverrides: { processGroup: 'Sheet Metal - Hydroforming' } }, 'SPCC', 'sheet_metal')).toEqual({ family: 'sheet_metal', familySource: 'process', warning: null });
  });

  // Cannula Holder bottom: Process Casting, analysed as a die casting, quoted and applied as investment casting. Its Design Guidance read the
  // die-casting limits (none for a steel) and the die's cores.
  it('a Casting part is made by the casting process its saved operations are in', () => {
    expect(appliedCastingFamily(['Casting Investment', 'Machining'])).toBe('investment_cast');
    expect(appliedCastingFamily(['Sand Casting'])).toBe('sand_cast');
    expect(appliedCastingFamily(['Die Casting'])).toBe('die_cast');
    expect(appliedCastingFamily(['Machining'])).toBeNull();
    expect(appliedCastingFamily([])).toBeNull();
  });
});
