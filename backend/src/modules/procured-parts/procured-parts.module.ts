/**
 * Procured Parts Module
 *
 * Production-grade NestJS module
 * - Encapsulates procured/purchased parts cost functionality
 * - Clean separation of concerns
 * - Dependency injection container
 *
 * @module ProcuredPartsModule
 * @version 1.0.0
 */

import { Module } from '@nestjs/common';
import { ProcuredPartsCostController } from './procured-parts-cost.controller';
import { ProcuredPartsCostService } from './procured-parts-cost.service';
import { DatabaseModule } from '../../common/database/database.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [ProcuredPartsCostController],
  providers: [ProcuredPartsCostService],
  exports: [ProcuredPartsCostService],
})
export class ProcuredPartsModule {}
