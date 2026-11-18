import { BadRequestException } from '@nestjs/common';
import { BOMItemsService } from '../../../modules/bom-items/bom-items.service';

// 2-Model Machining: a part names the item of the same BOM it is machined from. The service refuses, with the reason, a link the engine
// cannot price; migration 1066 enforces the same in the database (and no cycle).
const ITEMS: Record<string, Record<string, unknown>> = {
  part: { id: 'part', bom_id: 'bom-1', name: 'Housing machined', file_step_path: 'p.step', item_type: 'child_part', quantity: 1, annual_volume: null },
  casting: { id: 'casting', bom_id: 'bom-1', name: 'Housing casting', file_step_path: 'c.step' },
  sketch: { id: 'sketch', bom_id: 'bom-1', name: 'Sketch', file_step_path: null },
  other: { id: 'other', bom_id: 'bom-2', name: 'Other BOM part', file_step_path: 'o.step' },
};

function service(updateError: { code: string; message: string } | null = null) {
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    from: () => ({
      select: () => ({ in: async (_c: string, ids: string[]) => ({ data: ids.map((i) => ITEMS[i]).filter(Boolean), error: null }) }),
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: () => ({ select: () => ({ limit: async () => (updateError ? { data: null, error: updateError } : { data: [{ ...ITEMS.part, ...patch }], error: null }) }) }) };
      },
    }),
  };
  const svc = new BOMItemsService({ getUserClient: () => client } as never, {} as never);
  return { svc, updates };
}

describe('setting a part\'s source component', () => {
  it('links an item of the same BOM with a STEP model', async () => {
    const { svc, updates } = service();
    const dto = await svc.setSourceItem('part', 'casting', 'token');
    expect(updates[0]).toMatchObject({ source_item_id: 'casting' });
    expect(dto.sourceItemId).toBe('casting');
  });

  it('clears the link with null', async () => {
    const { svc, updates } = service();
    await svc.setSourceItem('part', null, 'token');
    expect(updates[0]).toMatchObject({ source_item_id: null });
  });

  it('refuses itself, another BOM\'s item and an item with no STEP model, each with its reason', async () => {
    const { svc, updates } = service();
    await expect(svc.setSourceItem('part', 'part', 'token')).rejects.toThrow('cannot be its own source');
    await expect(svc.setSourceItem('part', 'other', 'token')).rejects.toThrow('same BOM');
    await expect(svc.setSourceItem('part', 'sketch', 'token')).rejects.toThrow('has no STEP model');
    expect(updates).toEqual([]);
  });

  it('a cycle the database refuses (migration 1066) is a 400 with its reason', async () => {
    const { svc } = service({ code: '23514', message: 'a source component cannot be machined from the part it is the source of' });
    await expect(svc.setSourceItem('part', 'casting', 'token')).rejects.toBeInstanceOf(BadRequestException);
  });
});
