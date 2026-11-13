/**
 * Tooling Costs Module
 *
 * NestJS module for tooling cost management
 * Provides controllers, services, and dependencies
 *
 * @module ToolingCostsModule
 * @version 1.0.0
 */

import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/database/database.module';
import { ToolingCostController } from './controllers/tooling-cost.controller';
import { ToolingCostService } from './services/tooling-cost.service';
import { ToolingCatalogController } from './controllers/tooling-catalog.controller';
import { ToolingCatalogService } from './services/tooling-catalog.service';

@Module({
  imports: [
    DatabaseModule, // For database access
  ],
  controllers: [
    ToolingCostController,
    ToolingCatalogController,
  ],
  providers: [
    ToolingCostService,
    ToolingCatalogService,
  ],
  exports: [
    ToolingCostService, // Export for use in other modules
  ],
})
export class ToolingCostsModule {}