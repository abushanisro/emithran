import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SessionActivityService } from './session-activity.service';
import { SessionController } from './session.controller';

/**
 * Global so the app-wide RequestAuthGuard and the session endpoints share ONE
 * SessionActivityService, and so one per-instance deadline cache.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [SessionController],
  providers: [SessionActivityService],
  exports: [SessionActivityService],
})
export class SessionModule {}
