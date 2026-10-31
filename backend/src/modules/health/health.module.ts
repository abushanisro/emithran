import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';
import { DatabaseHealthIndicator } from './indicators/database.health';
import { EngineHealthIndicator } from './indicators/engine.health';
import { DatabaseModule } from '../../common/database/database.module';
import { ElectronicsCostingModule } from '../electronics-costing/electronics-costing.module';

@Module({
  imports: [TerminusModule, HttpModule, DatabaseModule, ElectronicsCostingModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, EngineHealthIndicator],
})
export class HealthModule {}
