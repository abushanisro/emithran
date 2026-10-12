import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BOMItemsModule } from '../bom-items/bom-items.module';
import { CostingModule } from '../costing/costing.module';
import { CopilotController } from './copilot.controller';
import { CopilotMemoryService } from './copilot-memory.service';
import { CopilotService } from './copilot.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';

@Module({
  imports: [ConfigModule, BOMItemsModule, CostingModule, SupabaseModule],
  controllers: [CopilotController],
  providers: [CopilotService, CopilotMemoryService],
})
export class CopilotModule {}
