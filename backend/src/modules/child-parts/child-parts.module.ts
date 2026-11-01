/**
 * Child Parts Module
 *
 * Handles child part management and cost calculations
 * Integrates with BOM cost aggregation system
 *
 * @author Manufacturing Cost Engineering Team
 * @version 1.0.0
 */

import { Module } from '@nestjs/common';
import { ChildPartCostController } from './controllers/child-part-cost.controller';
import { ChildPartCostService } from './services/child-part-cost.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [ChildPartCostController],
  providers: [ChildPartCostService],
  exports: [ChildPartCostService],
})
export class ChildPartsModule {}
