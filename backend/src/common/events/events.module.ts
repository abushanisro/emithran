import { Global, Module } from '@nestjs/common';

import { EVENT_BUS, InProcessEventBus } from './event-bus';

/**
 * The live-progress event bus. In-process on purpose: the free-tier deployment runs one backend instance, and keeping the bus
 * in memory means the backend holds no direct Postgres connection. Moving to several instances means swapping this provider
 * for a shared bus (Postgres LISTEN/NOTIFY); nothing that publishes or subscribes changes.
 */
@Global()
@Module({
  providers: [{ provide: EVENT_BUS, useClass: InProcessEventBus }],
  exports: [EVENT_BUS],
})
export class EventsModule {}
