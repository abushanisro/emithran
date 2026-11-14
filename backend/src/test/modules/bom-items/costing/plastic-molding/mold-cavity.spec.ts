import { moldCavityLookup } from '../../../../../modules/bom-items/costing/plastic-molding/process/mold-cavity';
import { realPlasticReference } from './real-plastic-reference';

// The cavity and core: machined at the hours per square inch of part surface the reference gives for the mold's complexity and the surface's size
// (tblHrsPerSqInch{Simple,Average,Complex}), and polished to the default finish (defaultCavityFinishIM, SPIFinishes hours per square meter).
const MB = realPlasticReference().moldBase;

describe('the cavity reference', () => {
  it('has the three complexity tables, the borrowed face-count thresholds and the default finish SPI B3 at 600 h/m2', () => {
    expect(MB.cavityHoursPerSqInByComplexity.Average[0]).toEqual({ upToSqIn: 100, hoursPerSqIn: 0.18 });
    expect(MB.complexityFaceThresholds).toEqual({ simple: 500, average: 2500 });
    expect(MB.finish).toEqual({ name: 'SPI B3 - Normal Semi-Gloss', hoursPerSqM: 600 });
  });
});

describe('moldCavityLookup', () => {
  it('Back cover: 959 faces is average; 25,695.55 mm2 = 39.83 in2 takes the first row covering it (100 in2: 0.18 h/in2)', () => {
    const r = moldCavityLookup({ faceCount: 959, surfaceAreaMm2: 25_695.55, ref: MB });
    if ('missing' in r) throw new Error(r.missing.join());
    expect(r.complexity).toBe('Average');
    expect(r.hoursPerSqIn).toBe(0.18);
    expect(r.rowUpToSqIn).toBe(100);
  });

  it('the complexity follows the face count: up to 500 simple, up to 2,500 average, above complex', () => {
    const c = (faces: number) => { const r = moldCavityLookup({ faceCount: faces, surfaceAreaMm2: 10_000, ref: MB }); return 'missing' in r ? null : r.complexity; };
    expect([c(500), c(501), c(2500), c(2501)]).toEqual(['Simple', 'Average', 'Average', 'Complex']);
  });

  it('names a missing face count or surface area, never an assumed complexity', () => {
    const r = moldCavityLookup({ faceCount: null, surfaceAreaMm2: null, ref: MB });
    expect('missing' in r && r.missing.join(' ')).toMatch(/face count.*surface area/);
  });
});
