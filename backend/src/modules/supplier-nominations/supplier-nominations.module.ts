import { Module } from '@nestjs/common';
import { SupplierNominationsController } from './supplier-nominations.controller';
import { SupplierNominationsService } from './supplier-nominations.service';
import { FieldMappingService } from './services/field-mapping.service';
import { PartWiseCostAnalysisService } from './services/part-wise-cost-analysis.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [SupplierNominationsController],
  providers: [SupplierNominationsService, FieldMappingService, PartWiseCostAnalysisService],
  exports: [SupplierNominationsService, FieldMappingService, PartWiseCostAnalysisService]
})
export class SupplierNominationsModule {}