import { Module } from '@nestjs/common';
import { ProcessPlanningController } from './process-planning.controller';
import { ProcessPlanningService } from './process-planning.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [ProcessPlanningController],
  providers: [ProcessPlanningService],
  exports: [ProcessPlanningService],
})
export class ProcessPlanningModule {}