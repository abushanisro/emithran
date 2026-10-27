import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { ElectronicsQueueHealthIndicator } from '../electronics-costing/infrastructure/queue/queue.health';
import { HealthController } from './health.controller';
import { HealthModule } from './health.module';

// The real module graph: HealthModule imports ElectronicsCostingModule for its queue probe, and that probe must
// resolve the queue provider the electronics module owns. No database is contacted (providers are only constructed).
describe('HealthModule wiring', () => {
  it('resolves the controller with the electronics queue indicator from the real module graph', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [
            () => ({
              SUPABASE_URL: 'http://supabase.invalid',
              SUPABASE_ANON_KEY: 'a'.repeat(40),
              SUPABASE_SERVICE_KEY: 's'.repeat(40),
              ELECTRONICS_QUEUE_DRIVER: 'memory',
            }),
          ],
        }),
        HealthModule,
      ],
    }).compile();

    expect(moduleRef.get(HealthController)).toBeDefined();
    const indicator = moduleRef.get(ElectronicsQueueHealthIndicator, { strict: false });
    await expect(indicator.check('electronics_queue')).resolves.toEqual({ electronics_queue: { status: 'up', configured: true } });
    await moduleRef.close();
  });
});
