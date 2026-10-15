import { Global, Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { SessionActivityService } from './session-activity.service';
import { SessionController } from './session.controller';

/**
 * Global so the app-wide SupabaseAuthGuard and the session endpoints share ONE
 * SessionActivityService, and so one per-instance deadline cache.
 */
@Global()
@Module({
  imports: [SupabaseModule],
  controllers: [SessionController],
  providers: [SessionActivityService],
  exports: [SessionActivityService],
})
export class SessionModule {}
