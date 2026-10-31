import axios from 'axios';

import { BOMItemsController } from '../../../modules/bom-items/bom-items.controller';

jest.mock('axios');

/**
 * "Convert to STL" makes a viewable mesh from the item's STEP file. The STEP stays the analysis source: the CAD engine cannot
 * analyse a mesh, so losing it made "Refresh analysis" fail with "Invalid file type: .stl".
 */
describe('POST /bom-items/:id/convert-step', () => {
  const STEP = 'u/p/bom-items/i/3d/1793473277814_housing.step';
  const STL = 'u/p/bom-items/i/3d/1793473286030_housing.stl';

  function controller(item: { file3dPath: string; fileStepPath?: string }) {
    const update = jest.fn().mockResolvedValue({});
    const c = Object.create(BOMItemsController.prototype) as BOMItemsController;
    Object.assign(c, {
      bomItemsService: { findOne: jest.fn().mockResolvedValue({ bomId: 'b', ...item }), getProjectIdForBOM: jest.fn().mockResolvedValue('p'), update },
      fileStorageService: { getSignedUrl: jest.fn().mockResolvedValue('https://files/step'), uploadFile: jest.fn().mockResolvedValue({ storagePath: STL }) },
      stepConverterService: { isStepFile: (name: string) => /\.(step|stp)$/i.test(name), convertStepToStl: jest.fn().mockResolvedValue(Buffer.from('solid')) },
    });
    (axios.get as jest.Mock).mockResolvedValue({ data: Buffer.from('ISO-10303-21;') });
    return { c, update };
  }

  it('shows the STL but keeps the STEP as the file to analyse', async () => {
    const { c, update } = controller({ file3dPath: STEP });
    await c.convertStepFile('i', { id: 'u' } as never, 'token');
    expect(update).toHaveBeenCalledWith('i', { file3dPath: STL, fileStepPath: STEP }, 'u', 'token');
  });

  it('keeps an analysis source that was already recorded', async () => {
    const original = 'u/p/bom-items/i/3d/1793473200000_housing.stp';
    const { c, update } = controller({ file3dPath: STEP, fileStepPath: original });
    await c.convertStepFile('i', { id: 'u' } as never, 'token');
    expect(update).toHaveBeenCalledWith('i', { file3dPath: STL, fileStepPath: original }, 'u', 'token');
  });
});
