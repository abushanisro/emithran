import { Module } from '@nestjs/common';
import { BenchmarkSessionsController } from './benchmark-sessions.controller';
import { BenchmarkSessionsService } from './benchmark-sessions.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [SupabaseModule, LoggerModule],
  controllers: [BenchmarkSessionsController],
  providers: [BenchmarkSessionsService],
  exports: [BenchmarkSessionsService],
})
export class BenchmarkSessionsModule {}
