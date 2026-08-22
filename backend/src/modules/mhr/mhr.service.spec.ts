// Focused regression test for the removeAll() user-scoping bug fix: it
// previously deleted every user's mhr_records (admin client, no user_id
// filter) despite the log message already claiming "for user ${userId}" —
// and unlike the sibling LHR bug, this one was reachable live via the
// "Clear All" button on /hr-rates. Mocked-dependency pattern matches
// bom-items.currency.spec.ts's established convention.
import { MHRService } from './mhr.service';
import { type Logger } from '../../common/logger/logger.service';
import { type SupabaseService } from '../../common/supabase/supabase.service';
import { type ExchangeRateService } from '../../common/exchange-rate/exchange-rate.service';

describe('MHRService.removeAll', () => {
  it('scopes the delete to the calling user_id, not every user', async () => {
    const eqMock = jest.fn().mockReturnThis();
    const selectMock = jest.fn().mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock, select: selectMock });
    const fromMock = jest.fn().mockReturnValue({ delete: deleteMock });
    const adminClient = { from: fromMock };

    const supabaseService = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as unknown as SupabaseService;

    const service = new MHRService(
      supabaseService,
      { log: jest.fn(), error: jest.fn() } as unknown as Logger,
      {} as unknown as ExchangeRateService,
    );

    const result = await service.removeAll('user-456', 'token');

    expect(fromMock).toHaveBeenCalledWith('mhr_records');
    expect(eqMock).toHaveBeenCalledWith('user_id', 'user-456');
    expect(result).toEqual({ deleted: 3 });
  });
});
