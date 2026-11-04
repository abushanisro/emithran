import { BOMItemsService, hasCostModel } from '../../../modules/bom-items/bom-items.service';

/**
 * A part whose family has no cost model is not priced as sheet metal with zero geometry: its summary has no price and says what is
 * missing. The no-material-grade summary is the same shape.
 */
describe('which part families have a cost model', () => {
  it.each(['milled', 'turned', 'mill_turn', 'sheet_metal', 'plastic_molded', 'die_cast', 'sand_cast', 'investment_cast'])('%s has one', (family) => {
    expect(hasCostModel(family)).toBe(true);
  });

  it.each(['unknown', '', 'forged', 'anything the engineer typed'])('%p has none', (family) => {
    expect(hasCostModel(family)).toBe(false);
  });
});

describe('the unpriced summary', () => {
  const service = Object.create(BOMItemsService.prototype) as unknown as {
    unpricedSummary(input: { costingInputs: object; batchSize: number; family: string; missingInputs: string[]; warnings: string[] }): Record<string, unknown>;
  };
  const input = { costingInputs: { batchSize: 100 }, batchSize: 100 };

  it('has every money field at 0 and says what is missing', () => {
    const s = service.unpricedSummary({ ...input, family: 'unknown', missingInputs: ['partFamily'], warnings: ['No cost model'] });
    expect(s).toMatchObject({
      scenarioReady: false, missingInputs: ['partFamily'], family: 'unknown', warnings: ['No cost model'],
      materialCost: 0, totalProcessCost: 0, totalCost: 0, processLines: [], currency: 'USD', batchSize: 100,
    });
  });

  it('is the same summary the missing material grade gets', () => {
    const s = service.unpricedSummary({ ...input, family: 'unknown', missingInputs: ['materialGrade'], warnings: [] });
    expect(s).toMatchObject({ scenarioReady: false, missingInputs: ['materialGrade'], totalCost: 0 });
  });
});

describe('hasMeasuredGeometry', () => {
  const { hasMeasuredGeometry } = require('../../../modules/bom-items/bom-items.service');
  it('needs a positive volume and all three bounding-box sides', () => {
    expect(hasMeasuredGeometry({ volume: 10, maxLength: 1, maxWidth: 1, maxHeight: 1 })).toBe(true);
    expect(hasMeasuredGeometry({ volume: 10, maxLength: 1, maxWidth: 1 })).toBe(false);
    expect(hasMeasuredGeometry({ volume: 0, maxLength: 1, maxWidth: 1, maxHeight: 1 })).toBe(false);
    expect(hasMeasuredGeometry({})).toBe(false);
  });
});
