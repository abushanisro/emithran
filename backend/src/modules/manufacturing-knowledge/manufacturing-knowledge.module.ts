import { Module } from '@nestjs/common';
import { ManufacturingKnowledgeController } from './manufacturing-knowledge.controller';
import { ManufacturingKnowledgeService } from './manufacturing-knowledge.service';
import { ProcessValidationService } from './services/process-validation.service';
import { InspectionKnowledgeService } from './services/inspection-knowledge.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [ManufacturingKnowledgeController],
  providers: [ManufacturingKnowledgeService, ProcessValidationService, InspectionKnowledgeService],
  exports: [ManufacturingKnowledgeService, ProcessValidationService, InspectionKnowledgeService],
})
export class ManufacturingKnowledgeModule {}
