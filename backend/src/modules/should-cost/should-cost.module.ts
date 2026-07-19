import { Module } from '@nestjs/common';
import { ShouldCostController } from './should-cost.controller';
import { ShouldCostService } from './should-cost.service';
import { CalibrationService } from './calibration.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [ShouldCostController],
  providers: [ShouldCostService, CalibrationService],
  exports: [ShouldCostService, CalibrationService],
})
export class ShouldCostModule {}
