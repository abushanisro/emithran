import { Module } from '@nestjs/common';
import { QualityControlController } from './quality-control.controller';
import { QualityControlService } from './quality-control.service';
import { QualityInspectionService } from './services/quality-inspection.service';
import { QualityChecklistService } from './services/quality-checklist.service';

@Module({
  controllers: [QualityControlController],
  providers: [
    QualityControlService,
    QualityInspectionService,
    QualityChecklistService,
  ],
  exports: [
    QualityControlService,
    QualityInspectionService,
    QualityChecklistService,
  ],
})
export class QualityControlModule {}