import { Module } from '@nestjs/common';
import { CostEngineeringController } from './cost-engineering.controller';
import { CostEngineeringService } from './cost-engineering.service';
import { SupabaseModule } from '../../common/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [CostEngineeringController],
  providers: [CostEngineeringService],
  exports: [CostEngineeringService],
})
export class CostEngineeringModule {}
