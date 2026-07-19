/**
 * ManufacturingModule — the NestJS home of the Manufacturing Knowledge Engine.
 *
 * Phase 1: Provides IrBuilderService (converts BOM items → ManufacturingIR).
 * Pipeline stage handlers will be added as concrete implementations land.
 *
 * Import this module into any NestJS module that needs to build or consume a
 * ManufacturingIR. Do NOT import ManufacturingRulesModule from here — the
 * rules engine is one of the pipeline stage inputs, not a peer module.
 */

import { Module } from '@nestjs/common';
import { IrBuilderService } from './domain/ir/ir-builder.service';

@Module({
  providers: [IrBuilderService],
  exports: [IrBuilderService],
})
export class ManufacturingModule {}
