// Regression: api_request_logs refused every backend insert (42501) because write() used a user-scoped client
// while the table has no INSERT policy (migration 200). Real database, real service: the row must now land.
// The row is marked by a unique path and removed afterwards with the service key.
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as path from 'path';
import { DeveloperModule } from '../src/modules/developer/developer.module';
import { RequestLogsService } from '../src/modules/developer/services/request-logs.service';

jest.setTimeout(60_000);

describe('[e2e] request log write', () => {
  const marker = `/e2e-request-log-${Date.now()}`;
  let service: RequestLogsService;
  let admin: SupabaseClient;
  let anon: SupabaseClient;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: path.resolve(__dirname, '../.env') }), DeveloperModule],
    }).compile();
    const config = moduleRef.get(ConfigService);
    admin = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_SERVICE_KEY'));
    anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    service = moduleRef.get(RequestLogsService);
  });

  afterAll(async () => { await admin.from('api_request_logs').delete().eq('path', marker); });

  it('the table still refuses a client-side insert (no INSERT policy), which is why the backend must write with the service role', async () => {
    const { error } = await anon.from('api_request_logs').insert({ method: 'GET', path: marker, status_code: 200 });
    expect(error?.code).toBe('42501');
  });

  it('write() persists the row with its status and duration', async () => {
    await service.write({ userId: null, method: 'POST', path: marker, statusCode: 201, durationMs: 12 });
    const { data } = await admin.from('api_request_logs').select('method, status_code, duration_ms, error_code').eq('path', marker);
    expect(data).toEqual([{ method: 'POST', status_code: 201, duration_ms: 12, error_code: null }]);
  });
});
