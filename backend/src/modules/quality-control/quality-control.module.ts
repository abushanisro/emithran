import { Module } from '@nestjs/common';
import { QualityControlController } from './quality-control.controller';
import { QualityControlService } from './quality-control.service';
import { QualityInspectionService } from './services/quality-inspection.service';
import { QualityChecklistService } from './services/quality-checklist.service';
import { PDFProcessorService } from './services/pdf-processor.service';
import { DimensionExtractionService } from './services/dimension-extraction.service';
import { PDFProcessingController } from './controllers/pdf-processing.controller';
import { SupabaseModule } from '@/common/supabase/supabase.module';

@Module({
  imports: [SupabaseModule],
  controllers: [
    QualityControlController,
    PDFProcessingController,
  ],
  providers: [
    QualityControlService,
    QualityInspectionService,
    QualityChecklistService,
    PDFProcessorService,
    DimensionExtractionService,
  ],
  exports: [
    QualityControlService,
    QualityInspectionService,
    QualityChecklistService,
    PDFProcessorService,
    DimensionExtractionService,
  ],
})
export class QualityControlModule {}