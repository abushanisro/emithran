// Org-scoped tenancy Phase 3 (.claude/plans/delegated-gliding-swan.md): the
// RFQ module previously ran entirely through the service-role client
// (this.supabaseService.client, RLS bypassed) with manual user_id filtering
// as the ONLY enforcement. These tests prove the fix: create()/findOne()
// now use the RLS-scoped getClient(accessToken) instead of the admin
// client, and create() writes organization_id so RLS can actually enforce
// the org boundary.
import { RfqService } from './rfq.service';
import { type SupabaseService } from '../../common/supabase/supabase.service';
import { type RfqEmailService } from './services/rfq-email.service';
import { type RfqTrackingService } from './services/rfq-tracking.service';

function makeChain(result: { data: any; error: any; count?: number }) {
  const chain: any = {};
  const methods = ['select', 'eq', 'in', 'like', 'insert', 'update', 'order'];
  for (const m of methods) chain[m] = jest.fn().mockReturnValue(chain);
  chain.single = jest.fn().mockResolvedValue(result);
  chain.then = (resolve: any) => resolve(result);
  return chain;
}

describe('RfqService.create', () => {
  it('uses the RLS-scoped client (not the admin client) and writes organization_id', async () => {
    const rfqInsertChain = makeChain({ data: { id: 'rfq-1', user_id: 'user-456', bom_item_ids: [], vendor_ids: [] }, error: null });
    const bomItemsChain = makeChain({ data: null, error: null, count: 1 });
    const vendorsChain = makeChain({ data: null, error: null, count: 1 });
    const rfqNumberChain = makeChain({ data: null, error: null, count: 0 });

    const rlsFromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'rfq_records') return rfqInsertChain;
      if (table === 'bom_items') return bomItemsChain;
      if (table === 'vendors') return vendorsChain;
      throw new Error(`unexpected table on RLS client: ${table}`);
    });
    const adminFromMock = jest.fn().mockReturnValue(rfqNumberChain);

    const supabaseService = {
      getClient: jest.fn().mockReturnValue({ from: rlsFromMock }),
      client: { from: adminFromMock },
    } as unknown as SupabaseService;

    const service = new RfqService(
      supabaseService,
      {} as unknown as RfqEmailService,
      {} as unknown as RfqTrackingService,
    );

    await service.create(
      'user-456',
      { rfqName: 'Test RFQ', bomItemIds: ['item-1'], vendorIds: ['vendor-1'] } as any,
      'token-abc',
      'org-789',
    );

    expect(supabaseService.getClient).toHaveBeenCalledWith('token-abc');
    expect(rfqInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-456', organization_id: 'org-789' }),
    );
    // generateRfqNumber() deliberately stays on the admin client (rfq_number
    // is globally unique, not per-org) — confirm that didn't regress either.
    expect(adminFromMock).toHaveBeenCalledWith('rfq_records');
  });
});

describe('RfqService.findOne', () => {
  it('scopes the read through the RLS client without a manual user_id filter', async () => {
    const chain = makeChain({ data: { id: 'rfq-1', user_id: 'user-456' }, error: null });
    const fromMock = jest.fn().mockReturnValue(chain);
    const supabaseService = {
      getClient: jest.fn().mockReturnValue({ from: fromMock }),
    } as unknown as SupabaseService;

    const service = new RfqService(
      supabaseService,
      {} as unknown as RfqEmailService,
      {} as unknown as RfqTrackingService,
    );

    await service.findOne('rfq-1', 'user-456', 'token-abc');

    expect(supabaseService.getClient).toHaveBeenCalledWith('token-abc');
    expect(chain.eq).not.toHaveBeenCalledWith('user_id', expect.anything());
  });
});
