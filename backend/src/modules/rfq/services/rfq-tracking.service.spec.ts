// Org-scoped tenancy Phase 3 (.claude/plans/delegated-gliding-swan.md):
// proves createTracking() writes organization_id on all 3 inserted rows
// (rfq_tracking + its vendor/part junction rows) instead of leaving it
// unset, mirroring the pattern already proven for boms/mhr_records.
import { RfqTrackingService } from './rfq-tracking.service';
import { type SupabaseService } from '../../../common/supabase/supabase.service';

function makeChain(result: { data: any; error: any }) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'insert', 'single']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.single = jest.fn().mockResolvedValue(result);
  chain.then = (resolve: any) => resolve(result);
  return chain;
}

describe('RfqTrackingService.createTracking', () => {
  it('writes organization_id on the tracking record and its vendor/part rows', async () => {
    const trackingInsert = makeChain({ data: { id: 'tracking-1' }, error: null });
    const vendorsInsert = makeChain({ data: null, error: null });
    const partsInsert = makeChain({ data: null, error: null });
    const summarySelect = makeChain({
      data: { id: 'tracking-1', rfq_id: 'rfq-1', user_id: 'user-456', sent_at: new Date().toISOString() },
      error: null,
    });

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'rfq_tracking') return trackingInsert;
      if (table === 'rfq_tracking_vendors') return vendorsInsert;
      if (table === 'rfq_tracking_parts') return partsInsert;
      if (table === 'rfq_tracking_summary') return summarySelect;
      throw new Error(`unexpected table: ${table}`);
    });

    const supabaseService = {
      getClient: jest.fn().mockReturnValue({ from: fromMock }),
    } as unknown as SupabaseService;

    const service = new RfqTrackingService(supabaseService);

    await service.createTracking('user-456', 'token-abc', 'org-789', {
      rfqId: 'rfq-1',
      projectId: 'project-1',
      rfqName: 'Test RFQ',
      rfqNumber: 'RFQ-202608-001',
      vendors: [{ id: 'vendor-1', name: 'Vendor A' }],
      parts: [{ id: 'item-1', partNumber: 'P-1', description: 'desc', process: 'Machining' }],
    });

    expect(trackingInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-456', organization_id: 'org-789' }),
    );
    expect(vendorsInsert.insert).toHaveBeenCalledWith([
      expect.objectContaining({ organization_id: 'org-789', vendor_id: 'vendor-1' }),
    ]);
    expect(partsInsert.insert).toHaveBeenCalledWith([
      expect.objectContaining({ organization_id: 'org-789', bom_item_id: 'item-1' }),
    ]);
  });
});
