import { Module } from '@nestjs/common';
import { CalculatorsController } from './calculators.controller';
import { CalculatorsServiceV2 } from './calculators.service';
import { DatabaseService } from '../../common/database/database.service';
import { Logger } from '../../common/logger/logger.service';
import { BOMItemsModule } from '../bom-items/bom-items.module';

@Module({
  imports: [BOMItemsModule],
  controllers: [CalculatorsController],
  providers: [CalculatorsServiceV2, DatabaseService, Logger],
  exports: [CalculatorsServiceV2],
})
export class CalculatorsModule {}
