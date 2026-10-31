import { Module } from '@nestjs/common';
import { SupplierEvaluationGroupsController } from './supplier-evaluation-groups.controller';
import { SupplierEvaluationGroupsService } from './supplier-evaluation-groups.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [SupplierEvaluationGroupsController],
  providers: [SupplierEvaluationGroupsService],
  exports: [SupplierEvaluationGroupsService],
})
export class SupplierEvaluationGroupsModule {}