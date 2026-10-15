import { InternalServerErrorException } from '@nestjs/common';
import { LHRService } from '../../../modules/lhr/lhr.service';
import { type Logger } from '../../../common/logger/logger.service';
import { type SupabaseService } from '../../../common/supabase/supabase.service';
import { type ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';

// The dashboard only needs how many LHR records exist; count() must report it
// without transferring any rows, and read as the caller (RLS).
function serviceWith(result: { count: number | null; error: { message: string } | null }) {
  const select = jest.fn().mockResolvedValue(result);
  const client = { from: jest.fn().mockReturnValue({ select }) };
  const supabase = { getUserClient: jest.fn().mockReturnValue(client) } as unknown as SupabaseService;
  const service = new LHRService(
    supabase,
    { log: jest.fn(), error: jest.fn() } as unknown as Logger,
    {} as unknown as ExchangeRateService,
  );
  return { service, select, supabase };
}

describe('LHRService.count', () => {
  it('asks for a head-only exact count, as the caller', async () => {
    const { service, select, supabase } = serviceWith({ count: 42, error: null });
    await expect(service.count('tok')).resolves.toEqual({ total: 42 });
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true });
    expect(supabase.getUserClient).toHaveBeenCalledWith('tok');
  });

  it('reports zero when there are none', async () => {
    const { service } = serviceWith({ count: null, error: null });
    await expect(service.count('tok')).resolves.toEqual({ total: 0 });
  });

  it('fails rather than reporting zero when the count cannot be read', async () => {
    const { service } = serviceWith({ count: null, error: { message: 'boom' } });
    await expect(service.count('tok')).rejects.toThrow(InternalServerErrorException);
  });
});
