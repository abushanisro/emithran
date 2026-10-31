import { Module } from '@nestjs/common';
import { ManufacturingIntelligenceController } from './manufacturing-intelligence.controller';
import { ManufacturingIntelligenceService } from './manufacturing-intelligence.service';
import { DatabaseModule } from '../../common/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ManufacturingIntelligenceController],
  providers: [ManufacturingIntelligenceService],
  exports: [ManufacturingIntelligenceService],
})
export class ManufacturingIntelligenceModule {}
