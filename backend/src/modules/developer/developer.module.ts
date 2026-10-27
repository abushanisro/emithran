import { Module } from '@nestjs/common';
import { ApiKeysController } from './controllers/api-keys.controller';
import { ApiKeysService } from './services/api-keys.service';
import { SupabaseService } from '../../common/supabase/supabase.service';

// Request logs are no longer stored in the database (2026-10-27): only errors
// are kept, in the rotating error log file (common/logger/error-log-file.ts).
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService, SupabaseService],
})
export class DeveloperModule {}
