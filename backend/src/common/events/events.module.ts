import { Global, Inject, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';

import { EVENT_BUS, EventBus, InProcessEventBus } from './event-bus';
import { PostgresEventBus } from './postgres-event-bus';

/**
 * The live-progress event bus. EVENT_BUS_DATABASE_URL (a session or direct Postgres connection) selects LISTEN/NOTIFY,
 * which every backend instance shares; without it events stay inside this process, which is correct for one instance.
 */
@Global()
@Module({
  providers: [
    {
      provide: EVENT_BUS,
      useFactory: (): EventBus => {
        if (process.env.EVENT_BUS_DATABASE_URL) return new PostgresEventBus();
        if (process.env.NODE_ENV === 'production') {
          new Logger('EventsModule').warn(
            'EVENT_BUS_DATABASE_URL is not set: live progress events stay on the instance that publishes them. Set it before running more than one backend instance.',
          );
        }
        return new InProcessEventBus();
      },
    },
  ],
  exports: [EVENT_BUS],
})
export class EventsModule implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(EVENT_BUS) private readonly bus: EventBus) {}

  async onModuleInit(): Promise<void> {
    if (this.bus instanceof PostgresEventBus) await this.bus.start();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.bus instanceof PostgresEventBus) await this.bus.stop();
  }
}
