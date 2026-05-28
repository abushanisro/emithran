import { Module } from '@nestjs/common';
import { VaveController } from './vave.controller';
import { VaveService } from './vave.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [SupabaseModule, LoggerModule],
  controllers: [VaveController],
  providers: [VaveService],
  exports: [VaveService],
})
export class VaveModule {}
