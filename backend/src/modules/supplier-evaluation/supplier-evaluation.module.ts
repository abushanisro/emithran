import { Module } from '@nestjs/common';
import { SupplierEvaluationController } from './supplier-evaluation.controller';
import { SupplierEvaluationService } from './supplier-evaluation.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [SupplierEvaluationController],
  providers: [SupplierEvaluationService],
  exports: [SupplierEvaluationService],
})
export class SupplierEvaluationModule {}
