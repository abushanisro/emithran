import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';
import { SupabaseHealthIndicator } from './indicators/supabase.health';
import { EngineHealthIndicator } from './indicators/engine.health';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { ElectronicsCostingModule } from '../electronics-costing/electronics-costing.module';

@Module({
  imports: [TerminusModule, HttpModule, SupabaseModule, ElectronicsCostingModule],
  controllers: [HealthController],
  providers: [SupabaseHealthIndicator, EngineHealthIndicator],
})
export class HealthModule {}
