import { Module } from '@nestjs/common';
import { ProcessPlanningController } from './process-planning.controller';
import { ProcessPlanningService } from './process-planning.service';
import { DatabaseModule } from '../../common/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ProcessPlanningController],
  providers: [ProcessPlanningService],
  exports: [ProcessPlanningService],
})
export class ProcessPlanningModule {}