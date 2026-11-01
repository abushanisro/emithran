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
import { CommentController } from './controllers/comment.controller';
import { CommentService } from './services/comment.service';
import { SubtaskController } from './controllers/subtask.controller';
import { SubtaskService } from './services/subtask.service';
import { ProcessTrackingController } from './controllers/process-tracking.controller';
import { ProcessTrackingService } from './services/process-tracking.service';

@Module({
  imports: [
    DatabaseModule,
  ],
  controllers: [
    ProductionPlanningController,
    ProductionProcessController,
    ProductionEntryController,
    RemarkController,
    CommentController,
    SubtaskController,
    ProcessTrackingController,
  ],
  providers: [
    ProductionPlanningService,
    ProductionMaterialTrackingService,
    ProductionProcessService,
    ProductionEntryService,
    RemarkService,
    CommentService,
    SubtaskService,
    ProcessTrackingService,
  ],
  exports: [
    ProductionPlanningService,
    ProductionMaterialTrackingService,
    ProductionProcessService,
    ProductionEntryService,
    RemarkService,
    SubtaskService,
    ProcessTrackingService,
  ],
})
export class ProductionPlanningModule { }