// The rate book a quote reads from, against the real database: machine-hour and labour-hour rates
// come from one real mhr_records row each, carrying that row id and version stamps; reference rows
// still pending confirmation are left out; and no location is ever assumed.
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { ElectronicsRateBookLoader } from '../src/modules/electronics-costing/infrastructure/repositories/electronics-rate-book.loader';
import { ElectronicsReferenceRepository } from '../src/modules/electronics-costing/infrastructure/repositories/electronics-reference.repository';
import { findRates, rateVersion } from '../src/modules/electronics-costing/domain/rates/rate-book';

jest.setTimeout(120_000);

// A real PCB machine staged by migration 797 (flying probe tester), USA benchmark row.
const MACHINE = 'ATG- A5Neo Flying Probe Tester';

describe('[e2e] electronics rate book — real mhr_records rows', () => {
  let loader: ElectronicsRateBookLoader;
  let supabase: SupabaseService;
  let organizationId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') })],
      providers: [SupabaseService, ElectronicsReferenceRepository, ElectronicsRateBookLoader],
    }).compile();
    loader = moduleRef.get(ElectronicsRateBookLoader);
    supabase = moduleRef.get(SupabaseService);
    const org = await supabase.getPrivilegedClient('e2e check: any organization id to pass to the loader').from('organizations').select('id').limit(1).single();
    organizationId = (org.data as { id: string }).id;
  });

  // The newest of the real rows stored for the machine (the import exists twice; the rates agree).
  async function realRow() {
    const { data, error } = await supabase
      .getPrivilegedClient('e2e check: read the mhr_records row the rate book must agree with')
      .from('mhr_records')
      .select('id, mhr_usd_per_hour, usd_labor_rate_per_hr, economics_version, updated_at')
      .eq('machine_name', MACHINE)
      .eq('location', 'USA')
      .is('organization_id', null)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false });
    expect(error).toBeNull();
    return (data as Array<unknown>)[0] as { id: string; mhr_usd_per_hour: number; usd_labor_rate_per_hr: number; economics_version: string | number | null; updated_at: string };
  }

  it('returns the machine-hour and labour-hour rate of the real row, with its id and version stamps', async () => {
    const row = await realRow();
    const book = await loader.load(organizationId, [MACHINE], 'USA');

    const [mhr] = findRates(book, 'mhr_usd_per_hour', MACHINE);
    const [lhr] = findRates(book, 'lhr_usd_per_hour', MACHINE);
    expect(mhr).toMatchObject({ kind: 'machine_rate', value: row.mhr_usd_per_hour, unit: 'usd/h', currency: 'USD', recordId: row.id, sourceRef: `mhr_records:${row.id}` });
    expect(lhr).toMatchObject({ kind: 'labour_rate', value: row.usd_labor_rate_per_hr, unit: 'usd/h', recordId: row.id });
    expect(new Date(mhr.recordedAt as string).getTime()).toBe(new Date(row.updated_at).getTime());
    expect(mhr.recordVersion).toBe(row.economics_version === null ? undefined : String(row.economics_version));
  });

  it('two loads of an unchanged rate give the same rate version', async () => {
    const a = await loader.load(organizationId, [MACHINE], 'USA');
    const b = await loader.load(organizationId, [MACHINE], 'USA');
    expect(rateVersion(a.entries)).toBe(rateVersion(b.entries));
  });

  it('refuses to read machine rates without a location, rather than assume one', async () => {
    await expect(loader.load(organizationId, [MACHINE])).rejects.toThrow(/location is required/);
  });

  it('an unknown machine yields no rate (the engine then reports a gap), never a default', async () => {
    const book = await loader.load(organizationId, ['No Such Machine'], 'USA');
    expect(findRates(book, 'mhr_usd_per_hour')).toEqual([]);
    expect(findRates(book, 'lhr_usd_per_hour')).toEqual([]);
  });

  it('leaves reference rows that are pending confirmation out of the book', async () => {
    const reference = await new ElectronicsReferenceRepository(supabase).listRows();
    expect(reference.some((r) => r.status === 'sourced_pending_confirmation')).toBe(true);
    const book = await loader.load(organizationId);
    expect(book.entries.filter((e) => e.kind === 'reference')).toEqual(reference.filter((r) => r.status === 'sourced').map((r) => expect.objectContaining({ key: r.key })));
    expect(book.entries.some((e) => e.key === 'depanel_router.cutting_speed')).toBe(false);
  });
});
