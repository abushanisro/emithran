import { Module } from '@nestjs/common';
import { ShouldCostController } from './should-cost.controller';
import { ShouldCostService } from './should-cost.service';
import { CalibrationService } from './calibration.service';
import { DatabaseModule } from '../../common/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ShouldCostController],
  providers: [ShouldCostService, CalibrationService],
  exports: [ShouldCostService, CalibrationService],
})
export class ShouldCostModule {}
