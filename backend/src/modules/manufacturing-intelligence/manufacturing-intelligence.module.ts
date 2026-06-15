import { Module } from '@nestjs/common';
import { ManufacturingIntelligenceController } from './manufacturing-intelligence.controller';
import { ManufacturingIntelligenceService } from './manufacturing-intelligence.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [ManufacturingIntelligenceController],
  providers: [ManufacturingIntelligenceService],
  exports: [ManufacturingIntelligenceService],
})
export class ManufacturingIntelligenceModule {}
