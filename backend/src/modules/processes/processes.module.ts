import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ProcessesController } from './processes.controller';
import { ProcessesService } from './processes.service';
import { ProcessCostController } from './controllers/process-cost.controller';
import { ProcessCostService } from './services/process-cost.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [
    SupabaseModule,
    LoggerModule,
    MulterModule.register({ limits: { fileSize: 20 * 1024 * 1024 } }),
  ],
  controllers: [ProcessesController, ProcessCostController],
  providers: [ProcessesService, ProcessCostService],
  exports: [ProcessesService, ProcessCostService],
})
export class ProcessesModule {}
