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
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { ToolingCostController } from './controllers/tooling-cost.controller';
import { ToolingCostService } from './services/tooling-cost.service';

@Module({
  imports: [
    SupabaseModule, // For database access
  ],
  controllers: [
    ToolingCostController,
  ],
  providers: [
    ToolingCostService,
  ],
  exports: [
    ToolingCostService, // Export for use in other modules
  ],
})
export class ToolingCostsModule {}