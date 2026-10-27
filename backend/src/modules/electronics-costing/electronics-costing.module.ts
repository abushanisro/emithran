import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ElectronicsController } from './api/electronics.controller';
import { CreateContainerUseCase } from './application/create-container.use-case';
import { DeleteDesignUseCase } from './application/delete-design.use-case';
import { GetBoardPreviewUseCase } from './application/get-board-preview.use-case';
import { GetJobStatusUseCase } from './application/get-job-status.use-case';
import { GetReferenceCoverageUseCase } from './application/get-reference-coverage.use-case';
import { ListDesignsUseCase } from './application/list-designs.use-case';
import { BoardSetParser } from './application/parsers/board-set-parser';
import { FEATURE_GRAPH_PARSERS, PrecomputedGraphParser } from './application/parsers/feature-graph-parser';
import { PreviewArtifactService } from './application/preview-artifact.service';
import { ProcessParseJob } from './application/process-parse-job';
import { ProcessQuoteJob, RequestQuoteUseCase } from './application/quote.use-cases';
import { ReparseUploadUseCase } from './application/reparse-upload.use-case';
import { StartAssemblyUploadUseCase } from './application/start-assembly-upload.use-case';
import { StartUploadUseCase } from './application/start-upload.use-case';
import { ElectronicsWorkers } from './electronics-workers';
import { EcadEngineClient } from './infrastructure/ecad/ecad-engine.client';
import { electronicsJobQueueProvider } from './infrastructure/queue/queue.provider';
import { ElectronicsQueueHealthIndicator } from './infrastructure/queue/queue.health';
import { ElectronicsRateBookLoader } from './infrastructure/repositories/electronics-rate-book.loader';
import { ElectronicsReferenceRepository } from './infrastructure/repositories/electronics-reference.repository';
import { ElectronicsRepository } from './infrastructure/repositories/electronics.repository';
import { ElectronicsFileStore } from './infrastructure/storage/electronics-file-store';
import { SupabaseModule } from '../../common/supabase/supabase.module';

@Module({
  imports: [ConfigModule, SupabaseModule],
  controllers: [ElectronicsController],
  providers: [
    electronicsJobQueueProvider,
    ElectronicsQueueHealthIndicator,
    EcadEngineClient,
    BoardSetParser,
    // Registered parsers, in priority order. A new input tier is one new entry here.
    {
      provide: FEATURE_GRAPH_PARSERS,
      inject: [BoardSetParser],
      useFactory: (boardSet: BoardSetParser) => [new PrecomputedGraphParser(), boardSet],
    },
    ElectronicsRepository,
    ElectronicsReferenceRepository,
    ElectronicsRateBookLoader,
    ElectronicsFileStore,
    StartUploadUseCase,
    RequestQuoteUseCase,
    GetJobStatusUseCase,
    GetReferenceCoverageUseCase,
    GetBoardPreviewUseCase,
    PreviewArtifactService,
    ListDesignsUseCase,
    StartAssemblyUploadUseCase,
    CreateContainerUseCase,
    DeleteDesignUseCase,
    ReparseUploadUseCase,
    ProcessParseJob,
    ProcessQuoteJob,
    ElectronicsWorkers,
  ],
  // The readiness probe for this module's queue, for the health module to call.
  exports: [ElectronicsQueueHealthIndicator],
})
export class ElectronicsCostingModule {}
