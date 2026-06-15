import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LoggerModule } from '../../common/logger/logger.module';

import { EchoController } from './echo.controller';

import { EchoService } from './services/echo.service';
import { ConversationService } from './services/conversation.service';
import { EntityHydratorService } from './services/entity-hydrator.service';
import { AlertDetectorService } from './services/alert-detector.service';
import { AlertRankerService } from './services/alert-ranker.service';
import { AlertsService } from './services/alerts.service';
import { SuggestionService } from './services/suggestion.service';
// EntityHydratorService is used by SuggestionService for entity-aware nudges.
import { HintsService } from './services/hints.service';
import { ToolDispatcherService } from './tools/tool-dispatcher.service';

@Module({
  imports: [ConfigModule, SupabaseModule, LoggerModule],
  controllers: [EchoController],
  providers: [
    EchoService,
    ConversationService,
    EntityHydratorService,
    AlertDetectorService,
    AlertRankerService,
    AlertsService,
    SuggestionService,
    HintsService,
    ToolDispatcherService,
  ],
  exports: [EchoService],
})
export class EchoModule {}
