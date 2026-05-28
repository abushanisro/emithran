import { Module } from '@nestjs/common';
import { ApiKeysController } from './controllers/api-keys.controller';
import { RequestLogsController } from './controllers/request-logs.controller';
import { ApiKeysService } from './services/api-keys.service';
import { RequestLogsService } from './services/request-logs.service';
import { SupabaseService } from '../../common/supabase/supabase.service';

@Module({
  controllers: [ApiKeysController, RequestLogsController],
  providers: [ApiKeysService, RequestLogsService, SupabaseService],
  exports: [RequestLogsService],
})
export class DeveloperModule {}
