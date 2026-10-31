/**
 * Packaging & Logistics Module
 *
 * Production-grade NestJS module
 * - Encapsulates packaging and logistics cost functionality
 * - Provides controllers and services
 * - Follows dependency injection best practices
 *
 * @module PackagingLogisticsModule
 * @version 1.0.0
 */

import { Module } from '@nestjs/common';
import { PackagingLogisticsCostController } from './packaging-logistics-cost.controller';
import { PackagingLogisticsCostService } from './packaging-logistics-cost.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [PackagingLogisticsCostController],
  providers: [PackagingLogisticsCostService],
  exports: [PackagingLogisticsCostService],
})
export class PackagingLogisticsModule {}
