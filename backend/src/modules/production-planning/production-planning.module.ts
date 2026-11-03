import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/common/database/database.module';
import { ProductionPlanningController } from './production-planning.controller';
import { ProductionPlanningService } from './production-planning.service';
import { ProductionMaterialTrackingService } from './services/production-material-tracking.service';
import { ProductionProcessController } from './controllers/production-process.controller';
import { ProductionProcessService } from './services/production-process.service';
import { ProductionEntryController } from './controllers/production-entry.controller';
import { ProductionEntryService } from './services/production-entry.service';
import { RemarkController } from './controllers/remark.controller';
import { RemarkService } from './services/remark.service';
import { SubtaskController } from './controllers/subtask.controller';
import { SubtaskService } from './services/subtask.service';

@Module({
  imports: [
    DatabaseModule,
  ],
  controllers: [
    ProductionPlanningController,
    ProductionProcessController,
    ProductionEntryController,
    RemarkController,
    SubtaskController,
  ],
  providers: [
    ProductionPlanningService,
    ProductionMaterialTrackingService,
    ProductionProcessService,
    ProductionEntryService,
    RemarkService,
    SubtaskService,
  ],
  exports: [
    ProductionPlanningService,
    ProductionMaterialTrackingService,
    ProductionProcessService,
    ProductionEntryService,
    RemarkService,
    SubtaskService,
  ],
})
export class ProductionPlanningModule { }